//! Hub and pill windows: creation, placement and show/hide rules. The Win32 specifics of the
//! pill (extended styles, z-order keeper, hover hit-test) live in `pill_windows`.

use crate::app_state::{PillKind, PillState};
use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const PILL_LABEL: &str = "pill";
pub const HUB_LABEL: &str = "hub";
/// Logical size of the pill window; the visible capsule is drawn inside it.
const PILL_W: f64 = 360.0;
const PILL_H: f64 = 72.0;
/// The capsule sits this far (logical px) above the bottom edge of the pill window.
const CAPSULE_BOTTOM_MARGIN: i32 = 8;
/// The visible capsule floats this far (logical px) above the monitor's work area, so it
/// clears the taskbar (auto-hide included).
const PILL_GAP: f64 = 12.0;
/// Extra logical px around the capsule that still count as "hovering" it: the idle capsule is
/// only 8px tall, which is too fiddly to aim at.
const HIT_SLOP: f64 = 6.0;

/// Set by the keeper while a fullscreen app, game or presentation is in front.
pub static FULLSCREEN_HIDDEN: AtomicBool = AtomicBool::new(false);
/// Set while the pill UI shows its right-click menu: the interactive hit area is then the menu
/// rect (`pill_hit_rect`). Cleared on every pill state change and when the pill hides.
pub static MENU_OPEN: AtomicBool = AtomicBool::new(false);
/// Logical size of the menu rect the pill UI draws (centred, same bottom margin as the capsule).
const MENU_W: u32 = 340;
const MENU_H: u32 = 40;

/// Physical-pixel rect `(x, y, w, h)` of the pill window for a work area `(x, y, w, h)` and DPI
/// scale: horizontally centred, placed so the visible capsule floats 12 logical px above the
/// work-area bottom (the window's own bottom margin is part of that 12px).
pub fn pill_rect(work: (i32, i32, u32, u32), scale: f64) -> (i32, i32, u32, u32) {
    let w = (PILL_W * scale).round() as u32;
    let h = (PILL_H * scale).round() as u32;
    let gap = ((PILL_GAP - f64::from(CAPSULE_BOTTOM_MARGIN)) * scale).round() as i32;
    let x = work.0 + (work.2 as i32 - w as i32) / 2;
    let y = work.1 + work.3 as i32 - h as i32 - gap;
    (x, y, w, h)
}

/// Logical rect `(x, y, w, h)` of the visible capsule inside the pill window for a state
/// (`hover` only matters for the idle capsule). Mirrored by the pill UI; keep in sync.
pub fn pill_capsule_rect(kind: PillKind, hover: bool) -> (i32, i32, u32, u32) {
    let (w, h): (u32, u32) = match kind {
        PillKind::Idle if hover => (196, 32),
        PillKind::Idle => (44, 8),
        PillKind::Listening => (148, 36),
        PillKind::Locked => (212, 36),
        PillKind::Thinking => (72, 36),
        PillKind::Done => (148, 36),
        PillKind::Error => (280, 36),
    };
    let x = (PILL_W as i32 - w as i32) / 2;
    let y = PILL_H as i32 - CAPSULE_BOTTOM_MARGIN - h as i32;
    (x, y, w, h)
}

/// The logical rect that must receive the mouse: the menu rect while the menu is open,
/// otherwise the capsule.
pub fn pill_hit_rect(kind: PillKind, hover: bool, menu: bool) -> (i32, i32, u32, u32) {
    if menu {
        let x = (PILL_W as i32 - MENU_W as i32) / 2;
        let y = PILL_H as i32 - CAPSULE_BOTTOM_MARGIN - MENU_H as i32;
        (x, y, MENU_W, MENU_H)
    } else {
        pill_capsule_rect(kind, hover)
    }
}

/// What the keeper must do after a cursor sample: `(set click-through to, emit hover as)`,
/// each `None` when nothing changed. Click-through is the opposite of "cursor inside".
pub fn hover_transition(ignoring: bool, hover: bool, inside: bool) -> (Option<bool>, Option<bool>) {
    let ignore = (inside == ignoring).then_some(!inside);
    let emit = (inside != hover).then_some(inside);
    (ignore, emit)
}

/// Is the physical-pixel `cursor` over the hit rect (plus a small slop) of a pill window whose
/// top-left is `origin` (physical px) at DPI `scale`?
pub fn capsule_hit(
    cursor: (i32, i32),
    origin: (i32, i32),
    scale: f64,
    kind: PillKind,
    hover: bool,
    menu: bool,
) -> bool {
    let (cx, cy, cw, ch) = pill_hit_rect(kind, hover, menu);
    let px = |v: f64| (v * scale).round() as i32;
    let slop = px(HIT_SLOP);
    let left = origin.0 + px(f64::from(cx)) - slop;
    let top = origin.1 + px(f64::from(cy)) - slop;
    let right = origin.0 + px(f64::from(cx) + f64::from(cw)) + slop;
    let bottom = origin.1 + px(f64::from(cy) + f64::from(ch)) + slop;
    cursor.0 >= left && cursor.0 < right && cursor.1 >= top && cursor.1 < bottom
}

// QUERY_USER_NOTIFICATION_STATE values (shellapi.h), kept as plain ints so the rule is pure.
const QUNS_BUSY: i32 = 2;
const QUNS_RUNNING_D3D_FULL_SCREEN: i32 = 3;
const QUNS_PRESENTATION_MODE: i32 = 4;

/// Should the idle pill step aside for this `SHQueryUserNotificationState` value?
pub fn hide_for_quns(state: i32) -> bool {
    matches!(
        state,
        QUNS_BUSY | QUNS_RUNNING_D3D_FULL_SCREEN | QUNS_PRESENTATION_MODE
    )
}

/// Has the cursor moved to a different monitor than the one the pill was last placed on?
/// An unknown current monitor never counts as a change.
pub fn monitor_changed(prev: Option<isize>, cur: Option<isize>) -> bool {
    cur.is_some() && prev != cur
}

/// Should the pill window be visible? Hidden when not allowed; hidden while idle (not
/// dictating) when a fullscreen app/game/presentation is in front.
pub fn pill_visible(allowed: bool, fullscreen_hidden: bool, kind: PillKind) -> bool {
    allowed && !(fullscreen_hidden && kind == PillKind::Idle)
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
    // Click-through until the keeper sees the cursor over the capsule. After `harden` the pill
    // is driven natively only: tao flag setters (show/hide/ignore-cursor/...) would re-apply
    // tao's own style flags and undo ours.
    #[cfg(target_os = "windows")]
    crate::pill_windows::harden(&w);
    #[cfg(not(target_os = "windows"))]
    let _ = w.set_ignore_cursor_events(true);
    Ok(w)
}

#[cfg(target_os = "windows")]
fn place_pill(_app: &AppHandle, w: &WebviewWindow) {
    if let Ok(h) = w.hwnd() {
        crate::pill_windows::place_on_cursor_monitor(h.0 as isize);
    }
}

#[cfg(not(target_os = "windows"))]
fn place_pill(app: &AppHandle, w: &WebviewWindow) {
    use tauri::{PhysicalPosition, PhysicalSize};
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
    if let Ok(h) = w.hwnd() {
        crate::pill_windows::show_topmost(h.0 as isize);
        crate::pill_windows::wake_keeper();
    }
}

#[cfg(not(target_os = "windows"))]
fn show_topmost_noactivate(w: &WebviewWindow) {
    let _ = w.show();
}

#[cfg(target_os = "windows")]
fn hide_pill(w: &WebviewWindow) {
    if let Ok(h) = w.hwnd() {
        crate::pill_windows::hide(h.0 as isize);
    }
}

#[cfg(not(target_os = "windows"))]
fn hide_pill(w: &WebviewWindow) {
    let _ = w.hide();
}

/// Really visible? (tao's own visibility flag is stale for a natively shown pill.)
#[cfg(target_os = "windows")]
fn pill_shown(w: &WebviewWindow) -> bool {
    w.hwnd()
        .map(|h| crate::pill_windows::is_visible(h.0 as isize))
        .unwrap_or(false)
}

#[cfg(not(target_os = "windows"))]
fn pill_shown(w: &WebviewWindow) -> bool {
    w.is_visible().unwrap_or(false)
}

/// Apply a pill state to its window. The work runs on the main thread (Tauri window calls and
/// `SetWindowPos` on our own window belong there); calls are queued in order.
pub fn sync_pill(app: &AppHandle, st: &PillState, allowed: bool) {
    // Any state change closes the menu (the UI re-opens it if it wants it).
    MENU_OPEN.store(false, Ordering::Relaxed);
    let show = pill_visible(allowed, FULLSCREEN_HIDDEN.load(Ordering::Relaxed), st.state);
    let kind = st.state;
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || apply_pill(&handle, kind, show));
}

fn apply_pill(app: &AppHandle, kind: PillKind, show: bool) {
    let Some(w) = app.get_webview_window(PILL_LABEL) else {
        return;
    };
    if !show {
        MENU_OPEN.store(false, Ordering::Relaxed);
        hide_pill(&w);
        return;
    }
    let visible = pill_shown(&w);
    // Idle placement is the keeper's job (it follows the cursor's monitor); place here when the
    // pill appears and for every dictation so it opens where the user is looking.
    if !visible || matches!(kind, PillKind::Listening | PillKind::Locked) {
        place_pill(app, &w);
    }
    show_topmost_noactivate(&w);
}

/// The hub window's native handle, if it exists.
pub fn hub_hwnd(app: &AppHandle) -> Option<isize> {
    app.get_webview_window(HUB_LABEL)
        .and_then(|w| w.hwnd().ok())
        .map(|h| h.0 as isize)
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
    fn capsule_floats_12px_above_the_work_area() {
        // 1920x1080 monitor, taskbar takes the bottom 48 px, scale 1. The window bottom is
        // 4px up and the capsule has an 8px margin inside it: 12px visible gap.
        let (x, y, w, h) = pill_rect((0, 0, 1920, 1032), 1.0);
        assert_eq!((x, y, w, h), (780, 956, 360, 72));
        let (_, cy, _, ch) = pill_capsule_rect(PillKind::Idle, false);
        assert_eq!(1032 - (y + cy + ch as i32), 12);
    }

    #[test]
    fn pill_scales_with_dpi_and_respects_monitor_origin() {
        // Second monitor to the right, 150% scale.
        let (x, y, w, h) = pill_rect((1920, 0, 2560, 1400), 1.5);
        assert_eq!((w, h), (540, 108));
        assert_eq!(x, 1920 + (2560 - 540) / 2);
        assert_eq!(y, 1400 - 108 - 6);
    }

    #[test]
    fn pill_handles_negative_monitor_origin() {
        // A monitor left of and above the primary.
        let (x, y, ..) = pill_rect((-1920, -200, 1920, 1080), 1.0);
        assert_eq!(x, -1920 + (1920 - 360) / 2);
        assert_eq!(y, -200 + 1080 - 72 - 4);
    }

    #[test]
    fn capsule_sizes_match_the_contract() {
        let size = |k, h| {
            let (_, _, w, hh) = pill_capsule_rect(k, h);
            (w, hh)
        };
        assert_eq!(size(PillKind::Idle, false), (44, 8));
        assert_eq!(size(PillKind::Idle, true), (196, 32));
        assert_eq!(size(PillKind::Listening, false), (148, 36));
        assert_eq!(size(PillKind::Locked, false), (212, 36));
        assert_eq!(size(PillKind::Thinking, false), (72, 36));
        assert_eq!(size(PillKind::Done, false), (148, 36));
        assert_eq!(size(PillKind::Error, false), (280, 36));
        // hover only affects idle
        assert_eq!(size(PillKind::Locked, true), (212, 36));
    }

    #[test]
    fn capsule_is_centred_and_bottom_aligned_with_an_8px_margin() {
        for kind in [
            PillKind::Idle,
            PillKind::Listening,
            PillKind::Locked,
            PillKind::Thinking,
            PillKind::Done,
            PillKind::Error,
        ] {
            let (x, y, w, h) = pill_capsule_rect(kind, false);
            assert_eq!(x * 2 + w as i32, 360, "{kind:?} centred");
            assert_eq!(y + h as i32, 72 - 8, "{kind:?} bottom margin");
        }
    }

    #[test]
    fn hit_test_covers_capsule_plus_slop_and_scales() {
        // Window at (100, 900); idle capsule is x 158..202, y 56..64 logical.
        let hit = |p, scale| capsule_hit(p, (100, 900), scale, PillKind::Idle, false, false);
        assert!(hit((280, 960), 1.0), "centre");
        assert!(hit((254, 952), 1.0), "inside the 6px slop");
        assert!(!hit((240, 960), 1.0), "left of the capsule");
        assert!(!hit((280, 930), 1.0), "well above the capsule");
        // Same logical point at 200%: everything doubles relative to the window origin.
        assert!(capsule_hit(
            (100 + 360, 900 + 120),
            (100, 900),
            2.0,
            PillKind::Idle,
            false,
            false
        ));
        assert!(!capsule_hit(
            (100 + 360, 900 + 40),
            (100, 900),
            2.0,
            PillKind::Idle,
            false,
            false
        ));
        // Hover enlarges the target so the grown capsule does not flicker.
        assert!(!capsule_hit(
            (100 + 80, 960),
            (100, 900),
            1.0,
            PillKind::Idle,
            false,
            false
        ));
        assert!(capsule_hit(
            (100 + 80, 960),
            (100, 900),
            1.0,
            PillKind::Idle,
            true,
            false
        ));
    }

    #[test]
    fn menu_rect_is_340x40_centred_with_the_same_bottom_margin() {
        let (x, y, w, h) = pill_hit_rect(PillKind::Idle, false, true);
        assert_eq!((w, h), (340, 40));
        assert_eq!(x * 2 + w as i32, 360);
        assert_eq!(y + h as i32, 72 - 8);
        assert_eq!(
            pill_hit_rect(PillKind::Locked, false, false),
            pill_capsule_rect(PillKind::Locked, false)
        );
    }

    #[test]
    fn open_menu_keeps_the_cursor_interactive_outside_the_capsule() {
        // 20px left of the idle capsule (logical x ~138) is inside the menu rect only.
        let p = (100 + 138, 960);
        assert!(!capsule_hit(
            p,
            (100, 900),
            1.0,
            PillKind::Idle,
            false,
            false
        ));
        assert!(capsule_hit(p, (100, 900), 1.0, PillKind::Idle, false, true));
    }

    #[test]
    fn hover_transitions_only_report_changes() {
        // (ignoring, hover, inside) -> (set click-through, emit hover)
        assert_eq!(hover_transition(true, false, false), (None, None));
        assert_eq!(
            hover_transition(true, false, true),
            (Some(false), Some(true))
        );
        assert_eq!(hover_transition(false, true, true), (None, None));
        assert_eq!(
            hover_transition(false, true, false),
            (Some(true), Some(false))
        );
        // click-through state can drift from hover (e.g. hidden window): each is independent
        assert_eq!(hover_transition(false, false, false), (Some(true), None));
        assert_eq!(hover_transition(true, true, true), (Some(false), None));
    }
    #[test]
    fn quns_hides_only_for_busy_fullscreen_and_presentation() {
        // 1 not present, 2 busy, 3 d3d fullscreen, 4 presentation, 5 accepts, 6 quiet, 7 app
        let hidden: Vec<i32> = (0..=8).filter(|&s| hide_for_quns(s)).collect();
        assert_eq!(hidden, vec![2, 3, 4]);
    }

    #[test]
    fn monitor_change_detection() {
        assert!(monitor_changed(None, Some(1)));
        assert!(monitor_changed(Some(1), Some(2)));
        assert!(!monitor_changed(Some(2), Some(2)));
        assert!(!monitor_changed(Some(2), None), "unknown never counts");
        assert!(!monitor_changed(None, None));
    }

    #[test]
    fn visibility_rules() {
        use PillKind::*;
        assert!(pill_visible(true, false, Idle));
        assert!(!pill_visible(false, false, Idle), "setting off / hidden 1h");
        assert!(!pill_visible(true, true, Idle), "fullscreen hides idle");
        for k in [Listening, Locked, Thinking, Done, Error] {
            assert!(pill_visible(true, true, k), "{k:?} shows over fullscreen");
            assert!(!pill_visible(false, true, k));
        }
    }
}
