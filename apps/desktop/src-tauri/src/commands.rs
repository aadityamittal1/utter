//! IPC commands: settings, API key, models, audio, shortcuts, pill. Data commands (history,
//! dictionary, snippets, transforms, notes, stats) live in `commands_data`.

use crate::app_state::AppState;
use crate::audio::capture::list_input_devices;
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
    if let Some(n) = v.get("id").and_then(Value::as_str).and_then(|s| s.parse::<i64>().ok()) {
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

/// Persist `s`, apply side effects of what changed, and notify the UI.
pub fn apply_settings(st: &Arc<AppState>, new: Settings) -> CmdResult<Settings> {
    let old = st.settings_snapshot();
    settings::save(&st.settings_path(), &new).map_err(|e| format!("Couldn't save settings: {e}"))?;
    *st.settings.write() = new.clone();
    if old.microphone != new.microphone || old.keep_mic_warm != new.keep_mic_warm {
        st.drop_recorder();
    }
    if old.shortcuts != new.shortcuts {
        st.rebuild_bindings();
    }
    if old.launch_at_login != new.launch_at_login {
        set_autostart(&st.app, new.launch_at_login);
    }
    if old.show_pill != new.show_pill {
        crate::windows::sync_pill(&st.app, &st.pill.lock().clone(), st.pill_allowed());
    }
    if old.history_retention != new.history_retention && new.history_retention != Retention::Forever {
        st.purge_history();
    }
    st.emit("settings://changed", new.clone());
    Ok(new)
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
    let mut s = st.settings_snapshot();
    s.reset_shortcuts();
    apply_settings(&st, s)
}

#[tauri::command]
pub async fn complete_onboarding(st: St<'_>) -> CmdResult<()> {
    let mut s = st.settings_snapshot();
    s.onboarded = true;
    apply_settings(&st, s).map(|_| ())
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
        LlmError::Auth | LlmError::NoKey => "That key was rejected. Check it and try again.".into(),
        LlmError::RateLimited => "The key works but is rate limited right now.".into(),
        LlmError::Timeout | LlmError::Network(_) => {
            "Couldn't reach Anthropic. Check your connection.".into()
        }
        _ => "Couldn't verify the key.".into(),
    }
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

fn emit_progress(st: &AppState, id: &str, downloaded: u64, total: u64, done: bool, error: Option<String>) {
    let mut v = json!({ "id": id, "downloaded": downloaded, "total": total, "done": done });
    if let Some(e) = error {
        v["error"] = Value::String(e);
    }
    st.emit("model://progress", v);
}

#[tauri::command]
pub fn download_model(st: St, id: String) -> CmdResult<()> {
    let info = *catalog::catalog().iter().find(|m| m.id == id).ok_or("Unknown model")?;
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
                let cur = state.settings_snapshot();
                if !state.model_downloaded(&cur.active_model) {
                    let mut s = cur;
                    s.active_model = id.clone();
                    let _ = apply_settings(&state, s);
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
    let mut s = st.settings_snapshot();
    s.active_model = id;
    st.unload_engine();
    apply_settings(&st, s)?;
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
        let rec = state.recorder().map_err(|_| "Microphone unavailable".to_string())?;
        rec.start().map_err(|_| "Microphone unavailable".to_string())?;
        *state.mic_testing.lock() = true;
        Ok(())
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub async fn stop_mic_test(st: St<'_>) -> CmdResult<()> {
    let state = st.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        if std::mem::take(&mut *state.mic_testing.lock()) {
            if let Ok(r) = state.recorder() {
                let _ = r.stop();
            }
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

#[tauri::command]
pub fn pill_action(st: St, action: String) -> CmdResult<()> {
    match action.as_str() {
        "stop" => {
            let _ = st.session_tx.send(SessionMsg::Pill(PillInput::Stop));
        }
        "cancel" => {
            let _ = st.session_tx.send(SessionMsg::Pill(PillInput::Cancel));
        }
        "retry" => {
            let id = st.last_failed.lock().take();
            if let Some(id) = id {
                let state = st.inner().clone();
                std::thread::spawn(move || retry_into_focus(&state, id));
            }
        }
        "hide1h" => {
            *st.pill_hidden_until.lock() = Some(Instant::now() + Duration::from_secs(3600));
            crate::windows::sync_pill(&st.app, &st.pill.lock().clone(), false);
            let state = st.inner().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(3600));
                let cur = state.pill.lock().clone();
                crate::windows::sync_pill(&state.app, &cur, state.pill_allowed());
            });
        }
        "openHub" => crate::windows::show_hub(&st.app, None),
        "openSettings" => crate::windows::show_hub(&st.app, Some("settings")),
        _ => return Err("Unknown pill action".into()),
    }
    Ok(())
}

/// Pill "retry": re-run the failed recording and paste the result where focus is now.
fn retry_into_focus(st: &Arc<AppState>, id: i64) {
    use crate::app_state::PillKind;
    st.set_pill(PillKind::Thinking, "dictate", 0, None);
    match crate::pipeline::retry::retry_history(st, id) {
        Ok(item) => {
            let proc = crate::context::foreground_windows::foreground_app()
                .map(|a| a.process)
                .unwrap_or_default();
            let method = crate::insert::paste_method_for(&proc);
            match crate::insert::insert_text(&item.final_text, method, None) {
                Ok(()) => st.set_pill_timed(PillKind::Done, "dictate", None, 900),
                Err(_) => st.pill_error("dictate", "Couldn't paste, text is on your clipboard", 4000),
            }
        }
        Err(msg) => {
            *st.last_failed.lock() = Some(id);
            st.pill_error("dictate", &msg, 3500);
        }
    }
}
