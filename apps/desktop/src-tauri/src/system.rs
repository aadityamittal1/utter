//! System appearance (Windows accent colour, text scale, backdrop) exposed to the UI.
//!
//! The platform reads live in `system_windows` (WinRT `UISettings`); this module holds the
//! IPC types and the pure helpers. Non-Windows builds report no accent and a 1.0 scale.

use serde::Serialize;
use tauri::AppHandle;

pub const EVENT_ACCENT: &str = "system://accent";
pub const EVENT_TEXT_SCALE: &str = "system://text-scale";
pub const EVENT_BACKDROP: &str = "system://backdrop";

/// The Windows accent and its light/dark shades, each as `#rrggbb`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemAccent {
    pub accent: String,
    pub light1: String,
    pub light2: String,
    pub light3: String,
    pub dark1: String,
    pub dark2: String,
    pub dark3: String,
}

/// Result of `get_system_appearance`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemAppearance {
    pub accent: Option<SystemAccent>,
    pub text_scale: f64,
    /// Always `"solid"`: the hub is opaque (no Mica).
    pub backdrop: &'static str,
}

/// Payload of `system://text-scale`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct TextScalePayload {
    pub factor: f64,
}

/// Payload of `system://backdrop`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct BackdropPayload {
    pub kind: &'static str,
}

/// `#rrggbb` (lowercase) for an opaque colour.
pub fn color_to_hex(r: u8, g: u8, b: u8) -> String {
    format!("#{r:02x}{g:02x}{b:02x}")
}

/// Windows allows 100%..225% text scaling; anything else (including NaN) is clamped or reset.
pub fn clamp_text_scale(f: f64) -> f64 {
    if f.is_nan() {
        1.0
    } else {
        f.clamp(1.0, 2.25)
    }
}

/// Dedupe helper for change handlers: true (and `last` updated) when `fresh` differs from the
/// last emitted value or nothing has been emitted yet.
pub fn should_emit<T: PartialEq>(last: &mut Option<T>, fresh: T) -> bool {
    if last.as_ref() == Some(&fresh) {
        false
    } else {
        *last = Some(fresh);
        true
    }
}

/// Current appearance as the UI should see it.
pub fn current() -> SystemAppearance {
    #[cfg(target_os = "windows")]
    let (accent, text_scale) = crate::system_windows::read();
    #[cfg(not(target_os = "windows"))]
    let (accent, text_scale) = (None, 1.0);
    SystemAppearance {
        accent,
        text_scale,
        backdrop: "solid",
    }
}

/// Start watching for accent / text-scale changes and emit the `system://*` events. A no-op
/// off Windows.
pub fn start_watcher(app: AppHandle) {
    #[cfg(target_os = "windows")]
    crate::system_windows::start(app);
    #[cfg(not(target_os = "windows"))]
    let _ = app;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_is_lowercase_and_zero_padded() {
        assert_eq!(color_to_hex(0, 0, 0), "#000000");
        assert_eq!(color_to_hex(255, 255, 255), "#ffffff");
        assert_eq!(color_to_hex(0x0a, 0xb0, 0x05), "#0ab005");
    }

    #[test]
    fn text_scale_is_clamped() {
        assert_eq!(clamp_text_scale(0.5), 1.0);
        assert_eq!(clamp_text_scale(1.0), 1.0);
        assert_eq!(clamp_text_scale(1.5), 1.5);
        assert_eq!(clamp_text_scale(2.25), 2.25);
        assert_eq!(clamp_text_scale(3.0), 2.25);
        assert_eq!(clamp_text_scale(f64::NAN), 1.0);
        assert_eq!(clamp_text_scale(f64::INFINITY), 2.25);
    }

    fn sample_accent() -> SystemAccent {
        SystemAccent {
            accent: "#0078d4".into(),
            light1: "#60cdff".into(),
            light2: "#0093f9".into(),
            light3: "#0067c0".into(),
            dark1: "#005a9e".into(),
            dark2: "#003e6b".into(),
            dark3: "#001e36".into(),
        }
    }

    #[test]
    fn should_emit_first_unchanged_changed() {
        let mut last = None;
        assert!(should_emit(&mut last, 1.5), "first value emits");
        assert!(!should_emit(&mut last, 1.5), "unchanged does not");
        assert!(should_emit(&mut last, 2.0), "changed emits");
        assert_eq!(last, Some(2.0));
        assert!(!should_emit(&mut last, 2.0));
    }

    #[test]
    fn accent_serializes_exactly_the_seven_camel_case_keys() {
        let v = serde_json::to_value(sample_accent()).unwrap();
        let mut keys: Vec<_> = v.as_object().unwrap().keys().cloned().collect();
        keys.sort();
        assert_eq!(
            keys,
            ["accent", "dark1", "dark2", "dark3", "light1", "light2", "light3"]
        );
    }

    #[test]
    fn serializes_per_ipc_contract() {
        let a = SystemAppearance {
            accent: Some(sample_accent()),
            text_scale: 1.25,
            backdrop: "solid",
        };
        let v = serde_json::to_value(&a).unwrap();
        assert_eq!(v["textScale"], 1.25);
        assert_eq!(v["backdrop"], "solid");
        assert_eq!(v["accent"]["accent"], "#0078d4");
        assert_eq!(v["accent"]["dark3"], "#001e36");
        let none = SystemAppearance {
            accent: None,
            text_scale: 1.0,
            backdrop: "solid",
        };
        assert!(serde_json::to_value(&none).unwrap()["accent"].is_null());
        assert_eq!(
            serde_json::to_value(BackdropPayload { kind: "solid" }).unwrap(),
            serde_json::json!({"kind":"solid"})
        );
    }
}
