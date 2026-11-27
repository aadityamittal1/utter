//! IPC commands: settings, API key, models, audio, shortcuts, pill. Data commands (history,
//! dictionary, snippets, transforms, notes, stats) live in `commands_data`.

use crate::app_state::{AppState, PillKind};
use crate::audio::capture::list_input_devices;
use crate::hotkeys::action::Action;
use crate::hotkeys::hook_windows::{cancel_capture, capture_next_chord};
use crate::llm::client::{ClaudeClient, LlmError};
use crate::pipeline::machine::PillInput;
use crate::pipeline::session::SessionMsg;
use crate::settings::{self, Settings};
use crate::store::Retention;
use crate::stt::catalog;
use crate::stt::download::download_model as fetch_model;
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, State};
use tauri_plugin_autostart::ManagerExt;
use tokio_util::sync::CancellationToken;

pub type St<'a> = State<'a, Arc<AppState>>;
pub type CmdResult<T> = Result<T, String>;

// ---- id <-> string helpers (the UI types every id as a string) ----

/// Serialize with a numeric `id` rewritten as a string.
pub fn ipc<T: Serialize>(v: &T) -> Value {
    let mut val = serde_json::to_value(v).unwrap_or(Value::Null);
    if let Some(id) = val.get("id").and_then(Value::as_i64) {
        val["id"] = Value::String(id.to_string());
    }
    val
}

pub fn ipc_list<T: Serialize>(v: &[T]) -> Vec<Value> {
    v.iter().map(ipc).collect()
}

/// Deserialize a UI object whose `id` may be a numeric string.
pub fn from_ipc<T: serde::de::DeserializeOwned>(mut v: Value) -> CmdResult<T> {
    if let Some(n) = v
        .get("id")
        .and_then(Value::as_str)
        .and_then(|s| s.parse::<i64>().ok())
    {
        v["id"] = json!(n);
    }
    serde_json::from_value(v).map_err(|e| format!("Invalid data: {e}"))
}

pub fn parse_id(s: &str) -> CmdResult<i64> {
    s.trim().parse().map_err(|_| "Invalid id".to_string())
}

pub fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ---- settings ----

/// Replace the settings (serialised with every other settings write).
pub fn apply_settings(st: &Arc<AppState>, new: Settings) -> CmdResult<Settings> {
    let (old, new) = {
        let _guard = st.settings_lock.lock();
        commit_locked(st, new)?
    };
    after_commit(st, &old, &new);
    Ok(new)
}

/// Read-modify-write under the settings lock, so concurrent writers never lose each other's edits.
pub fn update_settings_with(
    st: &Arc<AppState>,
    f: impl FnOnce(&mut Settings),
) -> CmdResult<Settings> {
    let (old, new) = {
        let _guard = st.settings_lock.lock();
        let mut s = st.settings_snapshot();
        f(&mut s);
        commit_locked(st, s)?
    };
    after_commit(st, &old, &new);
    Ok(new)
}

/// First chord of a transform's shortcut as stored in `settings.shortcuts["transform:<id>"]`.
fn transform_chord(s: &Settings, id: &str) -> Option<String> {
    s.shortcuts
        .get(&Action::Transform(id.to_string()))
        .and_then(|v| v.first())
        .filter(|c| !c.trim().is_empty())
        .cloned()
}

/// Persist `new` and update in-memory state (settings, bindings, transform mirror). Caller
/// holds `settings_lock`; nothing here may block on the UI thread. Returns `(old, new)`.
fn commit_locked(st: &Arc<AppState>, new: Settings) -> CmdResult<(Settings, Settings)> {
    let old = st.settings_snapshot();
    settings::save(&st.settings_path(), &new)
        .map_err(|e| format!("Couldn't save settings: {e}"))?;
    *st.settings.write() = new.clone();
    if old.microphone != new.microphone || old.keep_mic_warm != new.keep_mic_warm {
        st.drop_recorder();
    }
    if old.shortcuts != new.shortcuts {
        // settings.shortcuts is the source of truth; mirror transform shortcuts onto the rows.
        for t in st.db.transforms_list() {
            let want = transform_chord(&new, &t.id);
            if want != t.shortcut {
                let mut t2 = t.clone();
                t2.shortcut = want;
                let _ = st.db.transforms_update(&t2);
            }
        }
        st.rebuild_bindings();
    }
    Ok((old, new))
}

/// Side effects that touch windows / the OS and the UI notification. Runs AFTER the settings
/// lock is released, so a main-thread command waiting on the lock can never deadlock with it.
fn after_commit(st: &Arc<AppState>, old: &Settings, new: &Settings) {
    if old.launch_at_login != new.launch_at_login {
        set_autostart(&st.app, new.launch_at_login);
    }
    if old.show_pill != new.show_pill {
        let cur = st.pill.lock().clone();
        crate::windows::sync_pill(&st.app, &cur, st.pill_allowed(cur.state));
    }
    if old.history_retention != new.history_retention && new.history_retention != Retention::Forever
    {
        st.purge_history();
    }
    st.emit("settings://changed", new.clone());
}

pub fn set_autostart(app: &AppHandle, on: bool) {
    let mgr = app.autolaunch();
    let res = if on { mgr.enable() } else { mgr.disable() };
    if let Err(e) = res {
        log::warn!("autostart change failed: {e}");
    }
}

#[tauri::command]
pub fn get_settings(st: St) -> Settings {
    st.settings_snapshot()
}

#[tauri::command]
pub async fn update_settings(st: St<'_>, settings: Settings) -> CmdResult<Settings> {
    apply_settings(&st, settings)
}

#[tauri::command]
pub async fn reset_shortcuts(st: St<'_>) -> CmdResult<Settings> {
    update_settings_with(&st, |s| s.reset_shortcuts())
}

#[tauri::command]
pub async fn complete_onboarding(st: St<'_>) -> CmdResult<()> {
    update_settings_with(&st, |s| s.onboarded = true)?;
    // The resting pill is part of a finished setup: make sure it is up (idempotent).
    let cur = st.pill.lock().clone();
    crate::windows::sync_pill(&st.app, &cur, st.pill_allowed(cur.state));
    Ok(())
}

#[tauri::command]
pub fn app_info(st: St) -> Value {
    json!({ "version": st.app.package_info().version.to_string() })
}

// ---- API key ----

#[tauri::command]
pub fn api_key_status() -> Value {
    match crate::secrets::get_api_key() {
        Some(k) => match crate::secrets::last4(&k) {
            Some(l) => json!({ "set": true, "last4": l }),
            None => json!({ "set": true }),
        },
        None => json!({ "set": false }),
    }
}

#[tauri::command]
pub fn set_api_key(key: String) -> CmdResult<()> {
    crate::secrets::set_api_key(&key).map_err(err)
}

#[tauri::command]
pub fn clear_api_key() -> CmdResult<()> {
    crate::secrets::clear_api_key().map_err(err)
}

fn llm_message(e: &LlmError) -> String {
    match e {
        LlmError::Auth(status) => format!(
            "That key was rejected. Check it and try again.{}",
            http_suffix(*status)
        ),
        LlmError::NoKey => "That key was rejected. Check it and try again.".into(),
        LlmError::RateLimited => format!(
            "The key works but is rate limited right now.{}",
            http_suffix(Some(429))
        ),
        LlmError::Timeout | LlmError::Network(_) => {
            "Couldn't reach Anthropic. Check your connection.".into()
        }
        // The message is already truncated and never contains the key.
        LlmError::Api { status, message } => {
            format!("Anthropic said: {message} (HTTP {status})")
        }
        _ => "Couldn't verify the key.".into(),
    }
}

fn http_suffix(status: Option<u16>) -> String {
    status.map(|s| format!(" (HTTP {s})")).unwrap_or_default()
}

#[tauri::command]
pub async fn test_api_key(st: St<'_>, key: Option<String>) -> CmdResult<()> {
    let key = key
        .map(|k| k.trim().to_string())
        .filter(|k| !k.is_empty())
        .or_else(crate::secrets::get_api_key)
        .ok_or("Add an API key first")?;
    let model = st.settings.read().ai_model.clone();
    ClaudeClient::new(key, model)
        .validate()
        .await
        .map_err(|e| llm_message(&e))
}

// ---- models ----

#[tauri::command]
pub fn list_models(st: St) -> Vec<Value> {
    let active = st.settings.read().active_model.clone();
    catalog::catalog()
        .iter()
        .map(|m| {
            json!({
                "id": m.id,
                "label": m.label,
                "sizeBytes": m.size_bytes,
                "multilingual": m.multilingual,
                "recommended": m.id == catalog::default_model_id(),
                "downloaded": st.model_downloaded(m.id),
                "active": m.id == active,
            })
        })
        .collect()
}

fn emit_progress(
    st: &AppState,
    id: &str,
    downloaded: u64,
    total: u64,
    done: bool,
    error: Option<String>,
) {
    let mut v = json!({ "id": id, "downloaded": downloaded, "total": total, "done": done });
    if let Some(e) = error {
        v["error"] = Value::String(e);
    }
    st.emit("model://progress", v);
}

#[tauri::command]
pub fn download_model(st: St, id: String) -> CmdResult<()> {
    let info = *catalog::catalog()
        .iter()
        .find(|m| m.id == id)
        .ok_or("Unknown model")?;
    let state: Arc<AppState> = st.inner().clone();
    let token = CancellationToken::new();
    {
        let mut d = state.downloads.lock();
        if d.contains_key(&id) {
            return Ok(());
        }
        d.insert(id.clone(), token.clone());
    }
    tauri::async_runtime::spawn(async move {
        let last = std::sync::Mutex::new(Instant::now() - Duration::from_secs(1));
        let s2 = state.clone();
        let id2 = id.clone();
        let res = fetch_model(&info, &state.models_dir(), token, move |d, t| {
            let mut l = last.lock().unwrap_or_else(|p| p.into_inner());
            if l.elapsed() >= Duration::from_millis(150) {
                *l = Instant::now();
                emit_progress(&s2, &id2, d, t, false, None);
            }
        })
        .await;
        state.downloads.lock().remove(&id);
        match res {
            Ok(_) => {
                emit_progress(&state, &id, info.size_bytes, info.size_bytes, true, None);
                // First run: make the model that just arrived the active one.
                let st2 = state.clone();
                let id2 = id.clone();
                let _ = update_settings_with(&state, |s| {
                    if !st2.model_downloaded(&s.active_model) {
                        s.active_model = id2;
                    }
                });
                // Preload whenever the model that just arrived is the active one.
                if state.settings_snapshot().active_model == id {
                    preload_engine(&state);
                }
            }
            Err(e) => {
                log::warn!("model download failed: {e}");
                let msg = if e.to_string().contains("cancelled") {
                    "Download cancelled".to_string()
                } else if e.to_string().contains("checksum") {
                    "The download was corrupted. Try again.".to_string()
                } else {
                    "Download failed. Check your connection and try again.".to_string()
                };
                emit_progress(&state, &id, 0, info.size_bytes, true, Some(msg));
            }
        }
    });
    Ok(())
}

/// Load the active model off-thread so the first dictation is not slowed by it.
pub fn preload_engine(st: &Arc<AppState>) {
    let st = st.clone();
    std::thread::spawn(move || {
        if st.model_downloaded(&st.settings.read().active_model) {
            if let Err(e) = st.engine() {
                log::warn!("model preload failed: {e}");
            }
        }
    });
}

#[tauri::command]
pub fn cancel_download(st: St, id: String) {
    if let Some(t) = st.downloads.lock().get(&id) {
        t.cancel();
    }
}

#[tauri::command]
pub fn delete_model(st: St, id: String) -> CmdResult<()> {
    if st.settings.read().active_model == id {
        return Err("Can't delete the active model".into());
    }
    let path = catalog::model_path(&st.models_dir(), &id);
    let _ = std::fs::remove_file(&path);
    let mut part = path.into_os_string();
    part.push(".part");
    let _ = std::fs::remove_file(part);
    Ok(())
}

#[tauri::command]
pub async fn set_active_model(st: St<'_>, id: String) -> CmdResult<()> {
    if !catalog::catalog().iter().any(|m| m.id == id) {
        return Err("Unknown model".into());
    }
    if !st.model_downloaded(&id) {
        return Err("Download the model first".into());
    }
    st.unload_engine();
    update_settings_with(&st, |s| s.active_model = id)?;
    preload_engine(st.inner());
    Ok(())
}

// ---- microphone ----

#[tauri::command]
pub async fn list_microphones() -> Vec<String> {
    tauri::async_runtime::spawn_blocking(list_input_devices)
        .await
        .unwrap_or_default()
}

#[tauri::command]
pub async fn start_mic_test(st: St<'_>) -> CmdResult<()> {
    let state = st.inner().clone();
    tauri::async_runtime::spawn_blocking(move || -> CmdResult<()> {
        // Checked here (not before spawning) and the flag is set before the stream starts,
        // so a dictation that starts meanwhile sees the test and stops it first.
        if state.is_session_active() {
            return Err("Finish dictating first".into());
        }
        *state.mic_testing.lock() = true;
        let started = state
            .recorder()
            .and_then(|r| r.start())
            .map_err(|_| "Microphone unavailable".to_string());
        if started.is_err() {
            *state.mic_testing.lock() = false;
        }
        started
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub async fn stop_mic_test(st: St<'_>) -> CmdResult<()> {
    let state = st.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        if *state.mic_testing.lock() {
            // Stop through the recorder the test used, then clear the flag.
            if let Ok(r) = state.recorder() {
                let _ = r.stop();
            }
            *state.mic_testing.lock() = false;
        }
    })
    .await
    .map_err(err)
}

// ---- shortcut capture ----

#[tauri::command]
pub fn start_shortcut_capture(st: St) {
    let state = st.inner().clone();
    std::thread::spawn(move || {
        if let Ok(chord) = capture_next_chord(Duration::from_secs(30)) {
            state.emit("shortcut://captured", json!({ "chord": chord.to_string() }));
        }
    });
}

#[tauri::command]
pub fn stop_shortcut_capture() {
    cancel_capture();
}

// ---- pill ----

/// The session message a pill click action turns into. `toggle` is an unconditional stop (the
/// state machine ignores it when idle), `start` is decided on the worker; neither depends on
/// the pill state, which lags the session by `SHOW_AFTER`.
pub fn pill_session_msg(action: &str) -> Option<SessionMsg> {
    match action {
        "stop" | "toggle" => Some(SessionMsg::Pill(PillInput::Stop)),
        "cancel" => Some(SessionMsg::Pill(PillInput::Cancel)),
        "start" => Some(SessionMsg::PillStart),
        _ => None,
    }
}

#[tauri::command]
pub fn pill_action(st: St, action: String) -> CmdResult<()> {
    match action.as_str() {
        "stop" | "cancel" | "start" | "toggle" => {
            if let Some(msg) = pill_session_msg(&action) {
                let _ = st.session_tx.send(msg);
            }
        }
        "retry" => {
            // Only while the current pill is a retryable transcription failure.
            if let Some(id) = st.take_retry_target() {
                let state = st.inner().clone();
                std::thread::spawn(move || retry_into_focus(&state, id));
            }
        }
        "hide1h" => {
            *st.pill_hidden_until.lock() = Some(Instant::now() + Duration::from_secs(3600));
            let cur = st.pill.lock().clone();
            crate::windows::sync_pill(&st.app, &cur, false);
            let state = st.inner().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(3600));
                let cur = state.pill.lock().clone();
                crate::windows::sync_pill(&state.app, &cur, state.pill_allowed(cur.state));
            });
        }
        // The pill UI shows its menu inside the 340x40 menu rect; keep that rect interactive.
        "menuOpen" => {
            let kind = st.pill.lock().state;
            if crate::windows::menu_allowed(kind) {
                crate::windows::MENU_OPEN.store(true, std::sync::atomic::Ordering::Relaxed);
            }
        }
        "menuClose" => crate::windows::MENU_OPEN.store(false, std::sync::atomic::Ordering::Relaxed),
        "openHub" => crate::windows::show_hub(&st.app, None),
        "openSettings" => crate::windows::show_hub(&st.app, Some("settings")),
        _ => return Err("Unknown pill action".into()),
    }
    Ok(())
}

/// Pill "retry": re-run the failed recording and paste the result where focus is now.
fn retry_into_focus(st: &Arc<AppState>, id: i64) {
    st.set_pill(PillKind::Thinking, "dictate", 0, None);
    match crate::pipeline::retry::retry_history(st, id) {
        Ok(item) => {
            let proc = crate::context::foreground_windows::foreground_app()
                .map(|a| a.process)
                .unwrap_or_default();
            let method = crate::insert::paste_method_for(&proc);
            match crate::insert::insert_text(&item.final_text, method, None) {
                Ok(()) => st.set_pill_timed(PillKind::Done, "dictate", None, 900),
                Err(_) => {
                    st.pill_error("dictate", "Couldn't paste, text is on your clipboard", 4000)
                }
            }
        }
        Err(msg) => st.pill_error("dictate", &msg, 3500),
    }
}

/// Windows accent colour, text scale and backdrop for the UI (see `system`).
#[tauri::command]
pub fn get_system_appearance() -> crate::system::SystemAppearance {
    crate::system::current()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pill_actions_map_to_session_messages_regardless_of_pill_state() {
        assert!(matches!(
            pill_session_msg("start"),
            Some(SessionMsg::PillStart)
        ));
        for a in ["stop", "toggle"] {
            assert!(matches!(
                pill_session_msg(a),
                Some(SessionMsg::Pill(PillInput::Stop))
            ));
        }
        assert!(matches!(
            pill_session_msg("cancel"),
            Some(SessionMsg::Pill(PillInput::Cancel))
        ));
        for a in [
            "retry",
            "hide1h",
            "openHub",
            "openSettings",
            "menuOpen",
            "bogus",
        ] {
            assert!(pill_session_msg(a).is_none(), "{a}");
        }
    }
    #[test]
    fn llm_messages_show_status_and_api_text() {
        assert_eq!(
            llm_message(&LlmError::Api {
                status: 400,
                message: "bad thing".into()
            }),
            "Anthropic said: bad thing (HTTP 400)"
        );
        assert!(llm_message(&LlmError::Auth(Some(401))).ends_with("(HTTP 401)"));
        assert!(llm_message(&LlmError::RateLimited).ends_with("(HTTP 429)"));
        assert!(!llm_message(&LlmError::Auth(None)).contains("HTTP"));
    }

    #[test]
    fn transform_chord_reads_first_nonempty_settings_entry() {
        let mut s = Settings::default();
        assert_eq!(
            transform_chord(&s, "polish").as_deref(),
            Some("Alt+Shift+1")
        );
        s.shortcuts
            .insert(Action::Transform("polish".into()), vec![]);
        assert_eq!(transform_chord(&s, "polish"), None);
        s.shortcuts
            .insert(Action::Transform("x".into()), vec!["  ".into()]);
        assert_eq!(transform_chord(&s, "x"), None);
        assert_eq!(transform_chord(&s, "missing"), None);
    }

    #[test]
    fn ids_round_trip_as_strings() {
        let v = ipc(&serde_json::json!({"id": 7, "word": "x"}));
        assert_eq!(v["id"], "7");
        let back: serde_json::Value = from_ipc(v).unwrap();
        assert_eq!(back["id"], 7);
        assert!(parse_id("abc").is_err());
    }
}
