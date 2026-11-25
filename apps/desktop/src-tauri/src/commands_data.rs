//! IPC commands for stored data: history, dictionary, snippets, transforms, notes, stats.

use crate::commands::{err, from_ipc, ipc, ipc_list, parse_id, CmdResult, St};
use crate::context::foreground_windows::foreground_app;
use crate::insert::{copy_text, insert_text, paste_method_for};
use crate::store::{Note, Transform};
use crate::text::dictionary::learn_candidates;
use crate::text::types::{DictEntry, Snippet};
use serde_json::Value;
use std::time::Duration;

// ---- history ----

#[tauri::command]
pub fn history_list(st: St, query: Option<String>, limit: u32, offset: u32) -> Vec<Value> {
    let q = query.as_deref().map(str::trim).filter(|q| !q.is_empty());
    ipc_list(&st.db.list_history(q, limit.min(500), offset))
}

#[tauri::command]
pub fn history_update_text(st: St, id: String, text: String) -> CmdResult<Vec<String>> {
    let id = parse_id(&id)?;
    let before = st.db.get_history(id).ok_or("That item no longer exists")?.final_text;
    st.db.update_history_text(id, &text).map_err(err)?;
    st.emit("history://changed", ());
    Ok(learn_candidates(&before, &text))
}

#[tauri::command]
pub async fn history_retry(st: St<'_>, id: String) -> CmdResult<Value> {
    let id = parse_id(&id)?;
    let state = st.inner().clone();
    let item = tauri::async_runtime::spawn_blocking(move || {
        crate::pipeline::retry::retry_history(&state, id)
    })
    .await
    .map_err(err)??;
    Ok(ipc(&item))
}

/// Paste a history item into the app the user was in before opening the hub: minimise the hub
/// so Windows hands focus back, paste, then bring the hub back.
#[tauri::command]
pub async fn history_insert(st: St<'_>, id: String) -> CmdResult<()> {
    let id = parse_id(&id)?;
    let text = st.db.get_history(id).ok_or("That item no longer exists")?.final_text;
    let state = st.inner().clone();
    tauri::async_runtime::spawn_blocking(move || -> CmdResult<()> {
        use tauri::Manager;
        let hub = state.app.get_webview_window(crate::windows::HUB_LABEL);
        if let Some(h) = &hub {
            let _ = h.minimize();
        }
        std::thread::sleep(Duration::from_millis(350));
        let proc = foreground_app().map(|a| a.process).unwrap_or_default();
        let res = insert_text(&text, paste_method_for(&proc), None);
        std::thread::sleep(Duration::from_millis(450));
        crate::windows::show_hub(&state.app, None);
        res.map_err(|_| "Couldn't paste. The text is on your clipboard.".to_string())
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub fn history_copy(st: St, id: String) -> CmdResult<()> {
    let item = st.db.get_history(parse_id(&id)?).ok_or("That item no longer exists")?;
    copy_text(&item.final_text);
    Ok(())
}

#[tauri::command]
pub fn history_audio_path(st: St, id: String) -> CmdResult<Option<String>> {
    Ok(st
        .db
        .history_audio_path(parse_id(&id)?)
        .filter(|p| std::path::Path::new(p).exists()))
}

#[tauri::command]
pub fn history_delete(st: St, id: String) -> CmdResult<()> {
    if let Some(p) = st.db.delete_history(parse_id(&id)?) {
        st.delete_audio_files([p]);
    }
    st.emit("history://changed", ());
    Ok(())
}

#[tauri::command]
pub fn history_clear(st: St) {
    let paths = st.db.clear_history();
    st.delete_audio_files(paths);
    st.emit("history://changed", ());
}

// ---- dictionary ----

#[tauri::command]
pub fn dictionary_list(st: St) -> Vec<Value> {
    ipc_list(&st.db.dictionary_list())
}

#[tauri::command]
pub fn dictionary_add(st: St, word: String, heard_as: Option<String>) -> CmdResult<Value> {
    let e = st.db.dictionary_add(&word, heard_as.as_deref(), false).map_err(err)?;
    Ok(ipc(&e))
}

#[tauri::command]
pub fn dictionary_update(st: St, entry: Value) -> CmdResult<Value> {
    let e: DictEntry = from_ipc(entry)?;
    Ok(ipc(&st.db.dictionary_update(&e).map_err(err)?))
}

#[tauri::command]
pub fn dictionary_delete(st: St, id: String) -> CmdResult<()> {
    st.db.dictionary_delete(parse_id(&id)?).map_err(err)
}

#[tauri::command]
pub fn dictionary_import_csv(st: St, text: String) -> CmdResult<usize> {
    st.db.dictionary_import_csv(&text).map_err(err)
}

#[tauri::command]
pub fn dictionary_export_csv(st: St) -> CmdResult<String> {
    st.db.dictionary_export_csv().map_err(err)
}

// ---- snippets ----

#[tauri::command]
pub fn snippets_list(st: St) -> Vec<Value> {
    ipc_list(&st.db.snippets_list())
}

#[tauri::command]
pub fn snippets_add(st: St, trigger: String, expansion: String) -> CmdResult<Value> {
    Ok(ipc(&st.db.snippets_add(&trigger, &expansion).map_err(err)?))
}

#[tauri::command]
pub fn snippets_update(st: St, snippet: Value) -> CmdResult<Value> {
    let s: Snippet = from_ipc(snippet)?;
    Ok(ipc(&st.db.snippets_update(&s).map_err(err)?))
}

#[tauri::command]
pub fn snippets_delete(st: St, id: String) -> CmdResult<()> {
    st.db.snippets_delete(parse_id(&id)?).map_err(err)
}

#[tauri::command]
pub fn snippets_import_csv(st: St, text: String) -> CmdResult<usize> {
    st.db.snippets_import_csv(&text).map_err(err)
}

#[tauri::command]
pub fn snippets_export_csv(st: St) -> CmdResult<String> {
    st.db.snippets_export_csv().map_err(err)
}

// ---- transforms ----

#[tauri::command]
pub fn transforms_list(st: St) -> Vec<Transform> {
    st.db.transforms_list()
}

#[tauri::command]
pub fn transforms_add(
    st: St,
    name: String,
    instruction: String,
    shortcut: Option<String>,
) -> CmdResult<Transform> {
    let t = st.db.transforms_add(&name, &instruction, shortcut.as_deref()).map_err(err)?;
    st.rebuild_bindings();
    Ok(t)
}

#[tauri::command]
pub fn transforms_update(st: St, transform: Transform) -> CmdResult<Transform> {
    let t = st.db.transforms_update(&transform).map_err(err)?;
    st.rebuild_bindings();
    Ok(t)
}

#[tauri::command]
pub fn transforms_delete(st: St, id: String) -> CmdResult<()> {
    st.db.transforms_delete(&id).map_err(err)?;
    st.rebuild_bindings();
    Ok(())
}

// ---- notes ----

#[tauri::command]
pub fn notes_list(st: St) -> Vec<Value> {
    ipc_list(&st.db.notes_list())
}

#[tauri::command]
pub fn notes_create(st: St) -> CmdResult<Value> {
    Ok(ipc(&st.db.notes_create().map_err(err)?))
}

#[tauri::command]
pub fn notes_update(st: St, note: Value) -> CmdResult<Value> {
    let n: Note = from_ipc(note)?;
    Ok(ipc(&st.db.notes_update(&n).map_err(err)?))
}

#[tauri::command]
pub fn notes_delete(st: St, id: String) -> CmdResult<()> {
    st.db.notes_delete(parse_id(&id)?).map_err(err)
}

// ---- stats ----

#[tauri::command]
pub fn insights_get(st: St) -> Value {
    let now = chrono::Utc::now().timestamp_millis();
    let tz = chrono::Local::now().offset().local_minus_utc() / 60;
    serde_json::to_value(st.db.insights(now, tz)).unwrap_or(Value::Null)
}

#[tauri::command]
pub fn usage_get(st: St) -> Value {
    let month = chrono::Local::now().format("%Y-%m").to_string();
    serde_json::to_value(st.db.usage_for_month(&month)).unwrap_or(Value::Null)
}

