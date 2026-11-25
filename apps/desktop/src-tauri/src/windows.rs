//! Hub and pill windows: creation, placement and show/hide rules.

use crate::app_state::{PillKind, PillState};
use serde_json::json;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

pub const PILL_LABEL: &str = "pill";
pub const HUB_LABEL: &str = "hub";
const PILL_W: f64 = 360.0;
const PILL_H: f64 = 72.0;
const PILL_BOTTOM_GAP: f64 = 48.0;

/// Physical-pixel rect `(x, y, w, h)` of the pill for a work area `(x, y, w, h)` and DPI
/// scale: horizontally centred, 48 logical px above the work-area bottom.
pub fn pill_rect(work: (i32, i32, u32, u32), scale: f64) -> (i32, i32, u32, u32) {
    let w = (PILL_W * scale).round() as u32;
    let h = (PILL_H * scale).round() as u32;
    let gap = (PILL_BOTTOM_GAP * scale).round() as i32;
    let x = work.0 + (work.2 as i32 - w as i32) / 2;
    let y = work.1 + work.3 as i32 - h as i32 - gap;
    (x, y, w, h)
}

/// Create the (initially hidden) pill window.
pub fn create_pill(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let w = WebviewWindowBuilder::new(app, PILL_LABEL, WebviewUrl::App("pill.html".into()))
        .title("Utter pill")
        .inner_size(PILL_W, PILL_H)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focusable(false)
        .focused(false)
        .visible(false)
        .build()?;
    let _ = w.set_ignore_cursor_events(true);
    Ok(w)
}

fn place_pill(app: &AppHandle, w: &WebviewWindow) {
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(m) = monitor else { return };
    let wa = m.work_area();
    let (x, y, pw, ph) = pill_rect(
        (wa.position.x, wa.position.y, wa.size.width, wa.size.height),
        m.scale_factor(),
    );
    // Position first: sizing a window that still sits on another monitor can be rescaled.
    let _ = w.set_position(PhysicalPosition::new(x, y));
    let _ = w.set_size(PhysicalSize::new(pw, ph));
}

/// Show without activating and keep above other topmost windows.
#[cfg(target_os = "windows")]
fn show_topmost_noactivate(w: &WebviewWindow) {
    use ::windows::Win32::Foundation::HWND;
    use ::windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW,
    };
    if let Ok(h) = w.hwnd() {
        // SAFETY: the handle belongs to our own live window.
        unsafe {
            let _ = SetWindowPos(
                HWND(h.0),
                Some(HWND_TOPMOST),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
            );
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn show_topmost_noactivate(w: &WebviewWindow) {
    let _ = w.show();
}

/// Apply a pill state to its window: hidden when not allowed, otherwise shown (never
/// activated); clicks pass through while idle.
pub fn sync_pill(app: &AppHandle, st: &PillState, allowed: bool) {
    let Some(w) = app.get_webview_window(PILL_LABEL) else {
        return;
    };
    if !allowed {
        let _ = w.hide();
        return;
    }
    let visible = w.is_visible().unwrap_or(false);
    if !visible || matches!(st.state, PillKind::Listening | PillKind::Locked) {
        place_pill(app, &w);
    }
    show_topmost_noactivate(&w);
    let _ = w.set_ignore_cursor_events(st.state == PillKind::Idle);
}

/// Show and focus the hub, optionally navigating it to `page`.
pub fn show_hub(app: &AppHandle, page: Option<&str>) {
    if let Some(w) = app.get_webview_window(HUB_LABEL) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        if let Some(p) = page {
            let _ = app.emit("hub://navigate", json!({ "page": p }));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pill_is_bottom_centered_48px_above_work_area() {
        // 1920x1080 monitor, taskbar takes the bottom 48 px, scale 1.
        assert_eq!(pill_rect((0, 0, 1920, 1032), 1.0), (780, 912, 360, 72));
    }

    #[test]
    fn pill_scales_with_dpi_and_respects_monitor_origin() {
        // Second monitor to the right, 150% scale.
        let (x, y, w, h) = pill_rect((1920, 0, 2560, 1400), 1.5);
        assert_eq!((w, h), (540, 108));
        assert_eq!(x, 1920 + (2560 - 540) / 2);
        assert_eq!(y, 1400 - 108 - 72);
    }
}
