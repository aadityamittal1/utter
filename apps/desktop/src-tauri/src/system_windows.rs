//! Windows accent colour and text scale via WinRT `UISettings`.
//!
//! `UISettings` raises `ColorValuesChanged` / `TextScaleFactorChanged` on a background thread;
//! the handlers re-read the values and emit the `system://*` events through the `AppHandle`.
//! The `UISettings` object and its event registrations live for the whole app run.

use crate::system::{
    clamp_text_scale, color_to_hex, should_emit, BackdropPayload, SystemAccent, TextScalePayload,
    EVENT_ACCENT, EVENT_BACKDROP, EVENT_TEXT_SCALE,
};
use ::windows::Foundation::TypedEventHandler;
use ::windows::UI::Color;
use ::windows::UI::ViewManagement::{UIColorType, UISettings};
use parking_lot::Mutex;
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};

/// Keeps the `UISettings` (and with it the event registrations) alive for the app run.
static WATCHER: OnceLock<UISettings> = OnceLock::new();

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
    // Compatibility event only: the hub is always opaque ("solid"); the command carries it too.
    let _ = app.emit(EVENT_BACKDROP, BackdropPayload { kind: "solid" });

    let ui = match UISettings::new() {
        Ok(ui) => ui,
        Err(e) => {
            log::warn!("UISettings unavailable, system appearance events disabled: {e}");
            return;
        }
    };

    // ColorValuesChanged fires several times per change (and for light/dark switches too):
    // only emit when the accent actually differs from what we last sent. The decision is made
    // under the lock, the emit happens after it is released.
    let last_accent: Mutex<Option<SystemAccent>> = Mutex::new(read_accent(&ui));
    let app_c = app.clone();
    let color_handler = TypedEventHandler::new(move |_, _| {
        if let Ok(fresh) = UISettings::new() {
            if let Some(accent) = read_accent(&fresh) {
                let emit = should_emit(&mut last_accent.lock(), accent.clone());
                if emit {
                    let _ = app_c.emit(EVENT_ACCENT, &accent);
                }
            }
        }
        Ok(())
    });
    if let Err(e) = ui.ColorValuesChanged(&color_handler) {
        log::warn!("could not subscribe to ColorValuesChanged: {e}");
    }

    let last_scale = Mutex::new(Some(read_scale(&ui)));
    let app_s = app.clone();
    let scale_handler = TypedEventHandler::new(move |_, _| {
        if let Ok(fresh) = UISettings::new() {
            let factor = read_scale(&fresh);
            let emit = should_emit(&mut last_scale.lock(), factor);
            if emit {
                let _ = app_s.emit(EVENT_TEXT_SCALE, TextScalePayload { factor });
            }
        }
        Ok(())
    });
    if let Err(e) = ui.TextScaleFactorChanged(&scale_handler) {
        log::warn!("could not subscribe to TextScaleFactorChanged: {e}");
    }

    let _ = WATCHER.set(ui);
}
