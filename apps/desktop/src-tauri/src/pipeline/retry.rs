//! Re-run a stored recording through Whisper and the text stage (History "Retry").

use super::process::{is_silent_audio, run_text_stage, transcribe, TextInput, TextOutcome};
use super::route::Mode;
use crate::app_state::AppState;
use crate::audio::wav::read_wav_16k;
use crate::store::{HistoryItem, HistoryMode, NewHistory};
use crate::text::types::word_count;
use std::path::Path;

/// Blocking; call from a worker/blocking thread. The old row is replaced by a new one
/// (same time and audio) holding the new result. Errors are user-facing strings.
pub fn retry_history(st: &AppState, id: i64) -> Result<HistoryItem, String> {
    let item = st.db.get_history(id).ok_or("That item no longer exists")?;
    let path = st
        .db
        .history_audio_path(id)
        .filter(|p| Path::new(p).exists())
        .ok_or("The audio for this item is not available")?;
    let samples = read_wav_16k(Path::new(&path)).map_err(|_| "Couldn't read the saved audio")?;
    let settings = st.settings_snapshot();
    let dict = st.db.dictionary_list();
    let snippets = st.db.snippets_list();
    let engine = st.engine().map_err(|e| e.to_string())?;
    let raw = if is_silent_audio(&samples) {
        String::new()
    } else {
        transcribe(&engine, &samples, &settings, &dict).map_err(|e| {
            log::error!("retry transcription failed: {e}");
            "Transcription failed".to_string()
        })?
    };
    let mode = match item.mode {
        HistoryMode::DictateEnhance => Mode::DictateEnhance,
        HistoryMode::Command => Mode::Command,
        _ => Mode::Dictate,
    };
    let key = st.api_key();
    let input = TextInput {
        raw: &raw,
        silent: false,
        mode,
        settings: &settings,
        category: item.category,
        app_name: &item.app_name,
        dict: &dict,
        snippets: &snippets,
        selection: None,
        api_key: key.as_deref(),
        base_url: None,
    };
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| e.to_string())?;
    let res = match rt.block_on(run_text_stage(&input)) {
        TextOutcome::Text(r) => r,
        TextOutcome::NeedKey => return Err("Add an API key to use commands".into()),
        TextOutcome::CommandFailed => return Err("Couldn't run that command".into()),
        TextOutcome::Nothing => return Err("Didn't catch that".into()),
    };
    if let Some(u) = &res.usage {
        let day = chrono::Local::now().format("%Y-%m-%d").to_string();
        let _ = st.db.add_usage(&day, &u.model, u.input, u.output);
    }
    // keepAudio off: the recording is not kept after a successful retry.
    let keep_audio = settings.keep_audio;
    let row = NewHistory {
        created_at: item.created_at,
        app_name: item.app_name.clone(),
        category: item.category,
        mode: item.mode,
        raw_text: res.raw.clone(),
        final_text: res.text.clone(),
        duration_ms: item.duration_ms,
        words: word_count(&res.text),
        used_ai: res.used_ai,
        audio_path: keep_audio.then(|| path.clone()),
        error: None,
    };
    // Insert the new row first so a failure never loses the item, then drop the old one.
    let new_id = st.db.insert_history(&row).map_err(|e| e.to_string())?;
    let _ = st.db.delete_history(id);
    if !keep_audio {
        let _ = std::fs::remove_file(&path);
    }
    *st.last.lock() = Some(crate::app_state::LastResult { text: res.text });
    st.emit("history://changed", ());
    st.db.get_history(new_id).ok_or_else(|| "Retry failed".to_string())
}
