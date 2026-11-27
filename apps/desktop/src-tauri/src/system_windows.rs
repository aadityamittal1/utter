//! Windows accent colour and text scale via WinRT `UISettings`.
//!
//! `UISettings` raises `ColorValuesChanged` / `TextScaleFactorChanged` on a background thread;
//! the handlers re-read the values and emit the `system://*` events through the `AppHandle`.
//! The `UISettings` object and its event registrations live for the whole app run.

use crate::system::{
    clamp_text_scale, color_to_hex, BackdropPayload, SystemAccent, TextScalePayload, EVENT_ACCENT,
    EVENT_BACKDROP, EVENT_TEXT_SCALE,
};
use ::windows::Foundation::TypedEventHandler;
use ::windows::UI::Color;
use ::windows::UI::ViewManagement::{UIColorType, UISettings};
use parking_lot::Mutex;
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};

/// Keeps the `UISettings` (and with it the handlers) alive.
struct Watcher {
    _settings: UISettings,
}

// SAFETY: `UISettings` is an agile WinRT object (callable from any thread); we only hold it
// to keep its event registrations alive and never touch it after construction.
unsafe impl Send for Watcher {}
// SAFETY: see above; no access through a shared reference at all.
unsafe impl Sync for Watcher {}

static WATCHER: OnceLock<Watcher> = OnceLock::new();

fn hex(c: Color) -> String {
    color_to_hex(c.R, c.G, c.B)
}

fn read_accent(ui: &UISettings) -> Option<SystemAccent> {
    let get = |t: UIColorType| ui.GetColorValue(t).ok().map(hex);
    Some(SystemAccent {
        accent: get(UIColorType::Accent)?,
        light1: get(UIColorType::AccentLight1)?,
        light2: get(UIColorType::AccentLight2)?,
        light3: get(UIColorType::AccentLight3)?,
        dark1: get(UIColorType::AccentDark1)?,
        dark2: get(UIColorType::AccentDark2)?,
        dark3: get(UIColorType::AccentDark3)?,
    })
}

fn read_scale(ui: &UISettings) -> f64 {
    ui.TextScaleFactor().map(clamp_text_scale).unwrap_or(1.0)
}

/// Current accent (if readable) and text scale.
pub fn read() -> (Option<SystemAccent>, f64) {
    match UISettings::new() {
        Ok(ui) => (read_accent(&ui), read_scale(&ui)),
        Err(e) => {
            log::warn!("UISettings unavailable: {e}");
            (None, 1.0)
        }
    }
}

/// Subscribe to accent and text-scale changes and emit the initial backdrop event.
pub fn start(app: AppHandle) {
    let ui = match UISettings::new() {
        Ok(ui) => ui,
        Err(e) => {
            log::warn!("UISettings unavailable, system appearance events disabled: {e}");
            return;
        }
    };

    let _ = app.emit(EVENT_BACKDROP, BackdropPayload { kind: "solid" });

    // ColorValuesChanged fires several times per change (and for light/dark switches too):
    // only emit when the accent actually differs from what we last sent.
    let last_accent: Mutex<Option<SystemAccent>> = Mutex::new(read_accent(&ui));
    let app_c = app.clone();
    let color_handler = TypedEventHandler::new(move |_, _| {
        if let Ok(fresh) = UISettings::new() {
            if let Some(accent) = read_accent(&fresh) {
                let mut last = last_accent.lock();
                if last.as_ref() != Some(&accent) {
                    let _ = app_c.emit(EVENT_ACCENT, &accent);
                    *last = Some(accent);
                }
            }
        }
        Ok(())
    });
    if let Err(e) = ui.ColorValuesChanged(&color_handler) {
        log::warn!("could not subscribe to ColorValuesChanged: {e}");
    }

    let last_scale = Mutex::new(read_scale(&ui));
    let app_s = app.clone();
    let scale_handler = TypedEventHandler::new(move |_, _| {
        if let Ok(fresh) = UISettings::new() {
            let factor = read_scale(&fresh);
            let mut last = last_scale.lock();
            if (*last - factor).abs() > f64::EPSILON {
                let _ = app_s.emit(EVENT_TEXT_SCALE, TextScalePayload { factor });
                *last = factor;
            }
        }
        Ok(())
    });
    if let Err(e) = ui.TextScaleFactorChanged(&scale_handler) {
        log::warn!("could not subscribe to TextScaleFactorChanged: {e}");
    }

    let _ = WATCHER.set(Watcher { _settings: ui });
}
