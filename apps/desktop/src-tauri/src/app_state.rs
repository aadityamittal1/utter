//! Shared application state: store, settings, recorder, Whisper engine, matcher, pill.

use crate::audio::capture::Recorder;
use crate::hotkeys::matcher::Matcher;
use crate::pipeline::bindings::build_bindings;
use crate::pipeline::session::SessionMsg;
use crate::settings::{self, Settings};
use crate::store::Db;
use crate::stt::catalog;
use crate::stt::engine::WhisperEngine;
use anyhow::{anyhow, Result};
use parking_lot::{Mutex, RwLock};
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::Sender;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PillKind {
    Idle,
    Listening,
    Locked,
    Thinking,
    Done,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PillState {
    pub state: PillKind,
    pub mode: String,
    pub elapsed_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl PillState {
    pub fn idle() -> Self {
        PillState {
            state: PillKind::Idle,
            mode: "dictate".into(),
            elapsed_ms: 0,
            message: None,
        }
    }
}

/// The most recent successful result (Paste last / Copy last).
#[derive(Debug, Clone)]
pub struct LastResult {
    pub text: String,
}

struct EngineSlot {
    model_id: String,
    engine: Arc<WhisperEngine>,
}

struct RecorderSlot {
    device: Option<String>,
    keep_warm: bool,
    recorder: Arc<Recorder>,
}

pub struct AppState {
    pub app: AppHandle,
    pub data_dir: PathBuf,
    pub db: Arc<Db>,
    pub settings: RwLock<Settings>,
    pub matcher: Arc<std::sync::Mutex<Matcher>>,
    pub session_tx: Sender<SessionMsg>,
    pub downloads: Mutex<HashMap<String, CancellationToken>>,
    pub last: Mutex<Option<LastResult>>,
    /// History id of the last transcription that failed (pill "retry").
    pub last_failed: Mutex<Option<i64>>,
    pub mic_testing: Mutex<bool>,
    pub paused_until: Mutex<Option<Instant>>,
    pub pill_hidden_until: Mutex<Option<Instant>>,
    pub pill: Mutex<PillState>,
    pill_gen: AtomicU64,
    engine: Mutex<Option<EngineSlot>>,
    recorder: Mutex<Option<RecorderSlot>>,
}

impl AppState {
    pub fn new(
        app: AppHandle,
        data_dir: PathBuf,
        session_tx: Sender<SessionMsg>,
    ) -> Result<Arc<Self>> {
        std::fs::create_dir_all(&data_dir)?;
        let db = Arc::new(Db::open(&data_dir.join("utter.db"))?);
        let settings = settings::load(&data_dir.join("settings.json"));
        let bindings = build_bindings(&settings, &db.transforms_list());
        Ok(Arc::new(AppState {
            app,
            data_dir,
            db,
            settings: RwLock::new(settings),
            matcher: Arc::new(std::sync::Mutex::new(Matcher::new(bindings))),
            session_tx,
            downloads: Mutex::new(HashMap::new()),
            last: Mutex::new(None),
            last_failed: Mutex::new(None),
            mic_testing: Mutex::new(false),
            paused_until: Mutex::new(None),
            pill_hidden_until: Mutex::new(None),
            pill: Mutex::new(PillState::idle()),
            pill_gen: AtomicU64::new(0),
            engine: Mutex::new(None),
            recorder: Mutex::new(None),
        }))
    }

    pub fn settings_path(&self) -> PathBuf {
        self.data_dir.join("settings.json")
    }
    pub fn models_dir(&self) -> PathBuf {
        self.data_dir.join("models")
    }
    pub fn audio_dir(&self) -> PathBuf {
        self.data_dir.join("audio")
    }

    pub fn settings_snapshot(&self) -> Settings {
        self.settings.read().clone()
    }

    pub fn emit<S: Serialize + Clone>(&self, event: &str, payload: S) {
        let _ = self.app.emit(event, payload);
    }

    /// Re-read transforms and settings into the hotkey matcher. Never holds the matcher lock
    /// while doing anything else.
    pub fn rebuild_bindings(&self) {
        let bindings = build_bindings(&self.settings_snapshot(), &self.db.transforms_list());
        if let Ok(mut m) = self.matcher.lock() {
            m.set_bindings(bindings);
        }
    }

    pub fn is_paused(&self) -> bool {
        let mut p = self.paused_until.lock();
        match *p {
            Some(t) if t > Instant::now() => true,
            Some(_) => {
                *p = None;
                false
            }
            None => false,
        }
    }

    pub fn pill_allowed(&self) -> bool {
        if !self.settings.read().show_pill {
            return false;
        }
        let mut h = self.pill_hidden_until.lock();
        match *h {
            Some(t) if t > Instant::now() => false,
            Some(_) => {
                *h = None;
                true
            }
            None => true,
        }
    }

    // ---- pill ----

    /// Publish a pill state. Returns the generation, used by timed resets.
    pub fn set_pill(&self, kind: PillKind, mode: &str, elapsed_ms: u64, message: Option<String>) -> u64 {
        let gen = self.pill_gen.fetch_add(1, Ordering::SeqCst) + 1;
        let st = PillState {
            state: kind,
            mode: mode.to_string(),
            elapsed_ms,
            message,
        };
        *self.pill.lock() = st.clone();
        self.emit("pill://state", st.clone());
        crate::windows::sync_pill(&self.app, &st, self.pill_allowed());
        crate::tray::sync_icon(&self.app, matches!(kind, PillKind::Listening | PillKind::Locked), self.is_paused());
        gen
    }

    /// Publish `kind`, then return to idle after `ms` unless something newer was published.
    pub fn set_pill_timed(self: &Arc<Self>, kind: PillKind, mode: &str, message: Option<String>, ms: u64) {
        let gen = self.set_pill(kind, mode, 0, message);
        let me = self.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(ms));
            if me.pill_gen.load(Ordering::SeqCst) == gen {
                me.set_pill(PillKind::Idle, "dictate", 0, None);
            }
        });
    }

    pub fn pill_error(self: &Arc<Self>, mode: &str, message: &str, ms: u64) {
        self.set_pill_timed(PillKind::Error, mode, Some(message.to_string()), ms);
    }

    pub fn pill_idle(&self) {
        self.set_pill(PillKind::Idle, "dictate", 0, None);
    }

    /// Update the elapsed time of the current recording state without a generation bump.
    pub fn pill_tick(&self, elapsed_ms: u64, message: Option<String>) {
        let mut cur = self.pill.lock();
        cur.elapsed_ms = elapsed_ms;
        if message.is_some() {
            cur.message = message;
        }
        let st = cur.clone();
        drop(cur);
        self.emit("pill://state", st);
    }

    // ---- recorder ----

    /// The recorder for the current microphone settings (rebuilt when they change).
    pub fn recorder(&self) -> Result<Arc<Recorder>> {
        let s = self.settings.read();
        let (device, keep_warm) = (s.microphone.clone(), s.keep_mic_warm);
        drop(s);
        let mut slot = self.recorder.lock();
        if let Some(r) = slot.as_ref() {
            if r.device == device && r.keep_warm == keep_warm {
                return Ok(r.recorder.clone());
            }
        }
        *slot = None; // drop the old one (closes its stream) before opening a new one
        let rec = Arc::new(Recorder::new(device.clone(), keep_warm)?);
        let app = self.app.clone();
        rec.set_level_sink(Box::new(move |bars: Vec<f32>| {
            let mean = if bars.is_empty() {
                0.0
            } else {
                bars.iter().sum::<f32>() / bars.len() as f32
            };
            let _ = app.emit("mic://level", mean);
            let _ = app.emit("pill://levels", bars);
        }));
        *slot = Some(RecorderSlot {
            device,
            keep_warm,
            recorder: rec.clone(),
        });
        Ok(rec)
    }

    /// Forget the recorder so the next use re-reads microphone settings.
    pub fn drop_recorder(&self) {
        *self.recorder.lock() = None;
    }

    // ---- whisper ----

    /// The loaded engine for the active model. `Err` text is user-facing.
    pub fn engine(&self) -> Result<Arc<WhisperEngine>> {
        let id = self.settings.read().active_model.clone();
        let mut slot = self.engine.lock();
        if let Some(s) = slot.as_ref() {
            if s.model_id == id {
                return Ok(s.engine.clone());
            }
        }
        let path = catalog::model_path(&self.models_dir(), &id);
        if !path.exists() {
            return Err(anyhow!("Download a speech model in Settings"));
        }
        let engine = Arc::new(WhisperEngine::load(&path)?);
        *slot = Some(EngineSlot {
            model_id: id,
            engine: engine.clone(),
        });
        Ok(engine)
    }

    pub fn unload_engine(&self) {
        *self.engine.lock() = None;
    }

    pub fn model_downloaded(&self, id: &str) -> bool {
        catalog::model_path(&self.models_dir(), id).exists()
    }

    pub fn api_key(&self) -> Option<String> {
        crate::secrets::get_api_key()
    }

    /// Delete audio files returned by history deletion/purge (missing files are fine).
    pub fn delete_audio_files(&self, paths: impl IntoIterator<Item = String>) {
        for p in paths {
            let _ = std::fs::remove_file(p);
        }
    }

    pub fn purge_history(&self) {
        let retention = self.settings.read().history_retention;
        let paths = self
            .db
            .purge_history(retention, chrono::Utc::now().timestamp_millis());
        if !paths.is_empty() {
            self.delete_audio_files(paths);
            self.emit("history://changed", ());
        }
    }
}
