//! The session worker: owns the recording state machine and runs each dictation end to end
//! on its own thread, so the keyboard hook and the Tauri main thread never block.

use super::machine::{self, Cmd, Input, PillInput, State};
use super::process::{
    is_silent_audio, run_text_stage, run_transform, transcribe, AiUsage, TextInput, TextOutcome,
};
use super::route::Mode;
use crate::app_state::{AppState, LastResult, PillKind};
use crate::audio::capture::Recorder;
use crate::audio::wav;
use crate::context::classify::{classify, display_name, AppInfo};
use crate::context::foreground_windows::{focus_window, foreground_app};
use crate::context::target::{paste_last_plan, press_target, PasteLastPlan};
use crate::hotkeys::action::Action;
use crate::hotkeys::matcher::HotkeyEvent;
use crate::insert::{capture_selection, copy_text, insert_text, paste_method_for};
use crate::sounds::{self, Sound};
use crate::store::{HistoryMode, NewHistory, Retention};
use crate::text::types::{word_count, Category};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::sync::Arc;
use std::time::{Duration, Instant};

const MIN_RECORDING_MS: u64 = 400;
const MAX_RECORDING: Duration = Duration::from_secs(20 * 60);
const WARN_AT: Duration = Duration::from_secs(19 * 60);
const TICK: Duration = Duration::from_millis(50);
/// The start sound and listening pill appear only once a recording has lasted this long, so a
/// replayed instant press+release (discarded as too short) never flickers or beeps.
const SHOW_AFTER: Duration = Duration::from_millis(150);

#[derive(Debug, Clone)]
pub enum SessionMsg {
    Hotkey(HotkeyEvent),
    Pill(PillInput),
}

struct Active {
    /// The recorder this session started; stopped through this handle even if settings change.
    recorder: Arc<Recorder>,
    mode: Mode,
    app: Option<AppInfo>,
    /// Window to re-focus before pasting; `None` pastes into whatever is focused at finish
    /// (our own tray/pill windows are never a target).
    target: Option<isize>,
    category: Category,
    app_name: String,
    started: Instant,
    warned: bool,
    last_tick: Instant,
    locked: bool,
    /// The start sound has played and the listening/locked pill is showing.
    shown: bool,
}

pub fn mode_str(m: Mode) -> &'static str {
    match m {
        Mode::Dictate => "dictate",
        Mode::DictateEnhance => "dictateEnhance",
        Mode::Command => "command",
    }
}

fn history_mode(m: Mode) -> HistoryMode {
    match m {
        Mode::Dictate => HistoryMode::Dictate,
        Mode::DictateEnhance => HistoryMode::DictateEnhance,
        Mode::Command => HistoryMode::Command,
    }
}

/// Start the worker thread.
pub fn spawn(st: Arc<AppState>, rx: Receiver<SessionMsg>) {
    let res = std::thread::Builder::new()
        .name("utter-session".into())
        .spawn(move || {
            let rt = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(rt) => rt,
                Err(e) => {
                    log::error!("session runtime failed: {e}");
                    return;
                }
            };
            Worker {
                st,
                rx,
                rt,
                state: State::Idle,
                active: None,
            }
            .run();
        });
    if let Err(e) = res {
        log::error!("could not start the session thread: {e}");
    }
}

struct Worker {
    st: Arc<AppState>,
    rx: Receiver<SessionMsg>,
    rt: tokio::runtime::Runtime,
    state: State,
    active: Option<Active>,
}

impl Worker {
    fn run(mut self) {
        loop {
            let msg = if self.active.is_some() {
                match self.rx.recv_timeout(TICK) {
                    Ok(m) => Some(m),
                    Err(RecvTimeoutError::Timeout) => None,
                    Err(RecvTimeoutError::Disconnected) => break,
                }
            } else {
                match self.rx.recv() {
                    Ok(m) => Some(m),
                    Err(_) => break,
                }
            };
            if let Some(m) = msg {
                self.handle(m);
            }
            if self.active.is_some() {
                self.tick();
            }
        }
    }

    fn handle(&mut self, msg: SessionMsg) {
        let input = match msg {
            SessionMsg::Hotkey(ev) => {
                if self.state == State::Idle && self.one_shot(&ev) {
                    return;
                }
                if self.state == State::Idle && self.is_start(&ev) && self.st.is_paused() {
                    return;
                }
                Input::Hotkey(ev)
            }
            SessionMsg::Pill(p) => Input::Pill(p),
        };
        self.apply(&input);
    }

    fn is_start(&self, ev: &HotkeyEvent) -> bool {
        matches!(
            ev,
            HotkeyEvent::Pressed(
                Action::Dictate | Action::DictateEnhance | Action::Command | Action::HandsFree
            ) | HotkeyEvent::DoubleTap(Action::Dictate)
        )
    }

    /// Actions that do not record: paste/copy last, quick note, transforms (idle only).
    fn one_shot(&mut self, ev: &HotkeyEvent) -> bool {
        let HotkeyEvent::Pressed(action) = ev else {
            return false;
        };
        match action {
            Action::PasteLast => self.paste_last(),
            Action::CopyLast => self.copy_last(),
            Action::QuickNote => crate::windows::show_hub(&self.st.app, Some("notes")),
            Action::Transform(id) => {
                if !self.st.is_paused() {
                    let id = id.clone();
                    self.transform(&id);
                }
            }
            _ => return false,
        }
        true
    }

    fn apply(&mut self, input: &Input) {
        let (next, cmd) = machine::step(self.state, input);
        self.state = next;
        match cmd {
            Some(Cmd::Start { mode, locked }) => {
                if !self.start(mode, locked) {
                    self.state = State::Idle;
                }
            }
            Some(Cmd::Lock) => {
                if let Some(a) = self.active.as_mut() {
                    a.locked = true;
                }
                if let Some(a) = self.active.as_ref().filter(|a| a.shown) {
                    self.st.set_pill(
                        PillKind::Locked,
                        mode_str(a.mode),
                        a.started.elapsed().as_millis() as u64,
                        None,
                    );
                }
            }
            Some(Cmd::Finish) => self.finish(),
            Some(Cmd::Discard) => self.discard(),
            None => {}
        }
    }

    fn set_recording(&self, on: bool) {
        if let Ok(mut m) = self.st.matcher.lock() {
            m.set_recording(on);
        }
    }

    fn tick(&mut self) {
        let Some(a) = self.active.as_mut() else {
            return;
        };
        let elapsed = a.started.elapsed();
        if elapsed >= MAX_RECORDING {
            self.apply(&Input::MaxDuration);
            return;
        }
        if !a.shown && elapsed >= SHOW_AFTER {
            a.shown = true;
            let (mode, locked) = (a.mode, a.locked);
            if self.st.settings.read().sounds {
                sounds::play(Sound::Start);
            }
            self.st.set_pill(
                if locked {
                    PillKind::Locked
                } else {
                    PillKind::Listening
                },
                mode_str(mode),
                elapsed.as_millis() as u64,
                None,
            );
            return;
        }
        if a.shown && a.last_tick.elapsed() >= Duration::from_millis(500) {
            a.last_tick = Instant::now();
            let msg = if elapsed >= WARN_AT && !a.warned {
                a.warned = true;
                Some("1 minute left".to_string())
            } else {
                None
            };
            self.st.pill_tick(elapsed.as_millis() as u64, msg);
        }
    }

    // ---- recording ----

    fn start(&mut self, mode: Mode, locked: bool) -> bool {
        let st = self.st.clone();
        let settings = st.settings_snapshot();
        // A new dictation ends a mic test first (stop through the recorder the test used).
        if *st.mic_testing.lock() {
            if let Ok(r) = st.recorder() {
                let _ = r.stop();
            }
            *st.mic_testing.lock() = false;
        }
        *st.last_failed.lock() = None;
        let app = foreground_app();
        if let Some(a) = &app {
            st.note_foreground(a);
        }
        let target = press_target(
            app.as_ref(),
            std::process::id(),
            crate::windows::hub_hwnd(&st.app),
        );
        let (category, app_name) = match &app {
            Some(a) if settings.context_awareness => {
                (classify(a, &settings.category_rules), display_name(a))
            }
            Some(a) => (Category::Other, display_name(a)),
            None => (Category::Other, "Unknown".to_string()),
        };
        let rec = st.recorder();
        let started = rec.and_then(|r| r.start().map(|()| r));
        let recorder = match started {
            Ok(r) => r,
            Err(e) => {
                log::warn!("microphone unavailable: {e}");
                if settings.sounds {
                    sounds::play(Sound::Error);
                }
                st.pill_error(mode_str(mode), "Microphone unavailable", 3000);
                return false;
            }
        };
        st.set_session_active(true);
        self.set_recording(true);
        self.active = Some(Active {
            recorder,
            mode,
            app,
            target,
            category,
            app_name,
            started: Instant::now(),
            warned: false,
            last_tick: Instant::now(),
            locked,
            shown: false,
        });
        true
    }

    fn discard(&mut self) {
        self.set_recording(false);
        if let Some(a) = self.active.take() {
            let _ = a.recorder.stop();
        }
        self.st.set_session_active(false);
        self.st.pill_idle();
    }

    fn finish(&mut self) {
        self.set_recording(false);
        let Some(active) = self.active.take() else {
            return;
        };
        let st = self.st.clone();
        let samples = active.recorder.stop();
        st.set_session_active(false);
        let dur_ms = samples.len() as u64 * 1000 / 16_000;
        if dur_ms < MIN_RECORDING_MS {
            st.pill_idle();
            return;
        }
        if st.settings.read().sounds {
            sounds::play(Sound::Stop);
        }
        st.set_pill(PillKind::Thinking, mode_str(active.mode), dur_ms, None);
        self.process(active, samples, dur_ms);
        // Events queued while processing stay in the channel; the run loop replays them
        // through the state machine in order (a queued press+release is a discarded tap).
    }

    // ---- processing ----

    fn fail(&self, mode: &str, msg: &str, ms: u64) {
        if self.st.settings.read().sounds {
            sounds::play(Sound::Error);
        }
        // Not a retryable transcription failure: a stale Retry target must not survive.
        *self.st.last_failed.lock() = None;
        self.st.pill_error(mode, msg, ms);
    }

    fn process(&mut self, a: Active, samples: Vec<f32>, dur_ms: u64) {
        let st = self.st.clone();
        let mode_s = mode_str(a.mode);
        let settings = st.settings_snapshot();
        let method = paste_method_for(a.app.as_ref().map(|x| x.process.as_str()).unwrap_or(""));

        // Command mode: grab the selection now that the chord keys are released.
        let same_window = match (&a.app, foreground_app()) {
            (Some(at_press), Some(now)) => a.target.is_some() && at_press.hwnd == now.hwnd,
            _ => false,
        };
        let selection = if a.mode == Mode::Command && same_window {
            capture_selection(method).filter(|s| !s.trim().is_empty())
        } else {
            None
        };

        let dict = st.db.dictionary_list();
        let snippets = st.db.snippets_list();
        let silent = is_silent_audio(&samples);
        let mut raw = String::new();
        if !silent {
            if !st.model_downloaded(&settings.active_model) {
                self.fail(mode_s, "Download a speech model in Settings", 4000);
                return;
            }
            let engine = match st.engine() {
                Ok(e) => e,
                Err(e) => {
                    log::error!("speech model load failed: {e}");
                    self.fail(mode_s, "Couldn't load the speech model", 4000);
                    return;
                }
            };
            match transcribe(&engine, &samples, &settings, &dict) {
                Ok(t) => raw = t,
                Err(e) => {
                    log::error!("transcription failed: {e}");
                    if self.record_failure(&a, &samples, dur_ms) {
                        if st.settings.read().sounds {
                            sounds::play(Sound::Error);
                        }
                        st.pill_error_retryable(mode_s, "Transcription failed", 3500);
                    } else {
                        self.fail(mode_s, "Transcription failed", 3000);
                    }
                    return;
                }
            }
        }

        let key = st.api_key();
        let input = TextInput {
            raw: &raw,
            silent,
            mode: a.mode,
            settings: &settings,
            category: a.category,
            app_name: &a.app_name,
            dict: &dict,
            snippets: &snippets,
            selection: selection.as_deref(),
            api_key: key.as_deref(),
            base_url: None,
        };
        let outcome = self.rt.block_on(run_text_stage(&input));
        match outcome {
            TextOutcome::Nothing => self.fail(mode_s, "Didn't catch that", 2000),
            TextOutcome::NeedKey => self.fail(mode_s, "Add an API key to use commands", 3500),
            TextOutcome::CommandFailed => self.fail(mode_s, "Couldn't run that command", 3500),
            TextOutcome::Text(r) => {
                let target = a.target;
                // No recorded target (our own window was focused at press): paste where the
                // user is now, with the paste method for that window.
                let mut copied_only = false;
                let pasted = if target.is_some() {
                    insert_text(&r.text, method, target)
                } else {
                    // Same plan as "Paste last": our own window (e.g. the tray) may still be in
                    // front, so hand focus back to the last external window or copy only.
                    let fg = foreground_app();
                    let plan = paste_last_plan(
                        fg.as_ref(),
                        std::process::id(),
                        crate::windows::hub_hwnd(&st.app),
                        *st.last_external.lock(),
                    );
                    let proc = match plan {
                        PasteLastPlan::Foreground => fg.map(|x| x.process),
                        PasteLastPlan::Refocus(h) if focus_window(h) => {
                            std::thread::sleep(Duration::from_millis(80));
                            foreground_app().map(|x| x.process)
                        }
                        _ => None,
                    };
                    match proc {
                        Some(p) => insert_text(&r.text, paste_method_for(&p), None),
                        None => {
                            copied_only = true;
                            Ok(())
                        }
                    }
                };
                if let Err(e) = &pasted {
                    log::warn!("insert failed: {e}");
                }
                log::debug!("session finished: mode={mode_s} action=insert");
                *st.last.lock() = Some(LastResult {
                    text: r.text.clone(),
                });
                *st.last_failed.lock() = None;
                self.record(
                    &a.app_name,
                    a.category,
                    history_mode(a.mode),
                    &r.raw,
                    &r.text,
                    dur_ms,
                    r.used_ai,
                    r.usage.as_ref(),
                    Some(&samples),
                );
                if copied_only {
                    self.copy_only(&r.text);
                } else if pasted.is_ok() {
                    st.set_pill_timed(PillKind::Done, mode_s, None, 900);
                } else {
                    self.fail(mode_s, "Couldn't paste, text is on your clipboard", 4000);
                }
            }
        }
    }

    /// Store a failed transcription with its audio so it can be retried.
    /// Returns true when the row and its audio were saved (so the pill may offer Retry).
    fn record_failure(&self, a: &Active, samples: &[f32], dur_ms: u64) -> bool {
        let st = &self.st;
        if st.settings.read().history_retention == Retention::Never {
            return false;
        }
        let created = chrono::Utc::now().timestamp_millis();
        let Some(path) = save_audio(st, created, samples) else {
            return false;
        };
        let path = Some(path);
        let row = NewHistory {
            created_at: created,
            app_name: a.app_name.clone(),
            category: a.category,
            mode: history_mode(a.mode),
            raw_text: String::new(),
            final_text: String::new(),
            duration_ms: dur_ms as i64,
            words: 0,
            used_ai: false,
            audio_path: path,
            error: Some("Transcription failed".into()),
        };
        match st.db.insert_history(&row) {
            Ok(id) => {
                *st.last_failed.lock() = Some(id);
                st.emit("history://changed", ());
                true
            }
            Err(_) => {
                st.delete_audio_files(row.audio_path.clone());
                false
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn record(
        &self,
        app_name: &str,
        category: Category,
        mode: HistoryMode,
        raw: &str,
        text: &str,
        dur_ms: u64,
        used_ai: bool,
        usage: Option<&AiUsage>,
        samples: Option<&[f32]>,
    ) {
        let st = &self.st;
        let settings = st.settings_snapshot();
        if let Some(u) = usage {
            let day = chrono::Local::now().format("%Y-%m-%d").to_string();
            if let Err(e) = st.db.add_usage(&day, &u.model, u.input, u.output) {
                log::warn!("usage not recorded: {e}");
            }
        }
        if settings.history_retention == Retention::Never {
            return;
        }
        let created = chrono::Utc::now().timestamp_millis();
        let audio_path = match samples {
            Some(s) if settings.keep_audio => save_audio(st, created, s),
            _ => None,
        };
        let row = NewHistory {
            created_at: created,
            app_name: app_name.to_string(),
            category,
            mode,
            raw_text: raw.to_string(),
            final_text: text.to_string(),
            duration_ms: dur_ms as i64,
            words: word_count(text),
            used_ai,
            audio_path,
            error: None,
        };
        if let Err(e) = st.db.insert_history(&row) {
            log::warn!("history not saved: {e}");
            // Don't leave an orphaned recording behind.
            st.delete_audio_files(row.audio_path.clone());
        }
        st.emit("history://changed", ());
    }

    // ---- one-shot actions ----

    fn last_text(&self) -> Option<String> {
        if let Some(l) = self.st.last.lock().clone() {
            return Some(l.text);
        }
        self.st
            .db
            .list_history(None, 5, 0)
            .into_iter()
            .find(|h| h.error.is_none() && !h.final_text.is_empty())
            .map(|h| h.final_text)
    }

    fn paste_last(&self) {
        let Some(text) = self.last_text() else {
            self.fail("dictate", "Nothing to paste yet", 2000);
            return;
        };
        let st = &self.st;
        let fg = foreground_app();
        if let Some(a) = &fg {
            st.note_foreground(a);
        }
        let plan = paste_last_plan(
            fg.as_ref(),
            std::process::id(),
            crate::windows::hub_hwnd(&st.app),
            *st.last_external.lock(),
        );
        let proc = match plan {
            PasteLastPlan::Foreground => fg.map(|a| a.process).unwrap_or_default(),
            PasteLastPlan::Refocus(h) => {
                // Our tray/hub has focus: hand it back to the window the user was in.
                if !focus_window(h) {
                    self.copy_only(&text);
                    return;
                }
                std::thread::sleep(Duration::from_millis(80));
                foreground_app().map(|a| a.process).unwrap_or_default()
            }
            PasteLastPlan::ClipboardOnly => {
                self.copy_only(&text);
                return;
            }
        };
        if let Err(e) = insert_text(&text, paste_method_for(&proc), None) {
            log::warn!("paste last failed: {e}");
            self.fail("dictate", "Couldn't paste", 3000);
        }
    }

    /// No window to paste into: leave the text on the clipboard and say so.
    fn copy_only(&self, text: &str) {
        copy_text(text);
        self.st.set_pill_timed(
            PillKind::Done,
            "dictate",
            Some("Copied \u{2014} press Ctrl+V".into()),
            2500,
        );
    }

    fn copy_last(&self) {
        match self.last_text() {
            Some(t) => {
                copy_text(&t);
                self.st
                    .set_pill_timed(PillKind::Done, "dictate", Some("Copied".into()), 900);
            }
            None => self.fail("dictate", "Nothing to copy yet", 2000),
        }
    }

    fn transform(&mut self, id: &str) {
        let st = self.st.clone();
        let Some(t) = st.db.transforms_list().into_iter().find(|t| t.id == id) else {
            return;
        };
        let Some(key) = st.api_key() else {
            self.fail("transform", "Add an API key to use transforms", 3500);
            return;
        };
        let app = foreground_app();
        let method = paste_method_for(app.as_ref().map(|a| a.process.as_str()).unwrap_or(""));
        let Some(selection) = capture_selection(method).filter(|s| !s.trim().is_empty()) else {
            self.fail("transform", "Select text first", 2500);
            return;
        };
        st.set_pill(PillKind::Thinking, "transform", 0, None);
        let settings = st.settings_snapshot();
        let res = self.rt.block_on(run_transform(
            &settings,
            &key,
            None,
            &t.instruction,
            &selection,
        ));
        let Some((out, usage)) = res else {
            self.fail("transform", "Couldn't run that transform", 3500);
            return;
        };
        let target = press_target(
            app.as_ref(),
            std::process::id(),
            crate::windows::hub_hwnd(&st.app),
        );
        let pasted = insert_text(&out, method, target);
        *st.last.lock() = Some(LastResult { text: out.clone() });
        *st.last_failed.lock() = None;
        let (category, app_name) = match &app {
            Some(a) if settings.context_awareness => {
                (classify(a, &settings.category_rules), display_name(a))
            }
            Some(a) => (Category::Other, display_name(a)),
            None => (Category::Other, "Unknown".to_string()),
        };
        self.record(
            &app_name,
            category,
            HistoryMode::Transform,
            &selection,
            &out,
            0,
            true,
            Some(&usage),
            None,
        );
        if pasted.is_ok() {
            st.set_pill_timed(PillKind::Done, "transform", None, 900);
        } else {
            self.fail(
                "transform",
                "Couldn't paste, text is on your clipboard",
                4000,
            );
        }
    }
}

/// Write `samples` to `audio/<created>.wav`; returns the path on success.
pub fn save_audio(st: &AppState, created_ms: i64, samples: &[f32]) -> Option<String> {
    let dir = st.audio_dir();
    std::fs::create_dir_all(&dir).ok()?;
    let path = dir.join(format!("{created_ms}.wav"));
    match wav::write_wav_16k(&path, samples) {
        Ok(()) => Some(path.to_string_lossy().into_owned()),
        Err(e) => {
            log::warn!("audio not saved: {e}");
            None
        }
    }
}
