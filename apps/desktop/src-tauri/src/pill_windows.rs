//! Win32 side of the pill overlay: explicit non-activating tool-window styles, a
//! `WM_MOUSEACTIVATE` guard, native placement on the cursor's monitor, and the keeper thread
//! that keeps the pill above everything and click-through except over its capsule.
//!
//! Threading: window styles, the subclass and show/hide run on the main thread. The keeper
//! thread only calls `SetWindowPos` with `SWP_ASYNCWINDOWPOS` (never blocks on the UI thread)
//! and marshals every Tauri window call through `run_on_main_thread`.

use crate::app_state::{AppState, PillKind};
use crate::windows::{
    capsule_hit, hide_for_quns, monitor_changed, pill_rect, sync_pill, FULLSCREEN_HIDDEN,
    PILL_LABEL,
};
use ::windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use ::windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromPoint, HMONITOR, MONITORINFO, MONITOR_DEFAULTTOPRIMARY,
};
use ::windows::Win32::UI::Accessibility::{SetWinEventHook, UnhookWinEvent, HWINEVENTHOOK};
use ::windows::Win32::UI::HiDpi::{GetDpiForMonitor, GetDpiForWindow, MDT_EFFECTIVE_DPI};
use ::windows::Win32::UI::Shell::{
    DefSubclassProc, RemoveWindowSubclass, SHQueryUserNotificationState, SetWindowSubclass,
};
use ::windows::Win32::UI::WindowsAndMessaging::{
    DispatchMessageW, GetCursorPos, GetMessageW, GetWindowLongPtrW, GetWindowRect, IsWindowVisible,
    SetTimer, SetWindowLongPtrW, SetWindowPos, TranslateMessage, EVENT_SYSTEM_FOREGROUND,
    GWL_EXSTYLE, HWND_TOPMOST, MA_NOACTIVATE, MSG, SET_WINDOW_POS_FLAGS, SWP_ASYNCWINDOWPOS,
    SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SWP_SHOWWINDOW,
    WINEVENT_OUTOFCONTEXT, WM_DISPLAYCHANGE, WM_DPICHANGED, WM_MOUSEACTIVATE, WM_NCDESTROY,
    WM_POWERBROADCAST, WM_SETTINGCHANGE, WM_TIMER, WS_EX_APPWINDOW, WS_EX_NOACTIVATE,
    WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
};
use serde_json::json;
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

/// Keeper heartbeat: also the cursor hit-test period.
const TICK_MS: u32 = 60;
const REASSERT_EVERY: Duration = Duration::from_millis(1500);
const FOLLOW_EVERY: Duration = Duration::from_millis(500);
const QUNS_EVERY: Duration = Duration::from_millis(500);
const SUBCLASS_ID: usize = 0x5554_5452; // "UTTR"

/// The pill's HWND for the WinEvent callback (which has no context pointer); 0 = none yet.
static HOOK_TARGET: AtomicIsize = AtomicIsize::new(0);
/// Set by the subclass when the display, DPI, work area or power state changed; the keeper
/// then re-places and re-asserts at its next heartbeat instead of waiting for a timer.
static DIRTY: AtomicBool = AtomicBool::new(false);

fn hwnd_of(raw: isize) -> HWND {
    HWND(raw as *mut _)
}

// ---------------------------------------------------------------- window hardening

/// Give the pill explicit tool-window / no-activate / topmost styles and guard against
/// activation by mouse. Must run on the thread that owns the window (the main thread), while
/// the window is still hidden so the taskbar/Alt-Tab change takes effect cleanly.
pub fn harden(w: &WebviewWindow) {
    let Ok(h) = w.hwnd() else { return };
    let hwnd = hwnd_of(h.0 as isize);
    // SAFETY: `hwnd` is our own live window and we are on its owning thread. The style
    // read-modify-write keeps whatever Tauri/tao set (e.g. WS_EX_LAYERED/TRANSPARENT toggled
    // by set_ignore_cursor_events); `SWP_FRAMECHANGED` makes the new styles take effect.
    unsafe {
        let mut ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        ex |= WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0 | WS_EX_TOPMOST.0;
        ex &= !WS_EX_APPWINDOW.0;
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex as isize);
        let _ = SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_FRAMECHANGED,
        );
        // Best effort: a failure only means hover-activation is not blocked.
        let _ = SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, 0);
    }
}

/// Subclass of the pill's top-level window. `WM_MOUSEACTIVATE` -> `MA_NOACTIVATE` stops clicks
/// (and "activate window by hovering") from stealing focus from the app being dictated into.
/// Child windows (the WebView2 host) forward unhandled `WM_MOUSEACTIVATE` to this parent.
unsafe extern "system" fn subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    id: usize,
    _data: usize,
) -> LRESULT {
    match msg {
        WM_MOUSEACTIVATE => return LRESULT(MA_NOACTIVATE as isize),
        WM_DISPLAYCHANGE | WM_DPICHANGED | WM_SETTINGCHANGE | WM_POWERBROADCAST => {
            DIRTY.store(true, Ordering::Relaxed);
        }
        WM_NCDESTROY => {
            // SAFETY: removing our own subclass from the window being destroyed.
            let _ = unsafe { RemoveWindowSubclass(hwnd, Some(subclass_proc), id) };
        }
        _ => {}
    }
    // SAFETY: forwarding the unmodified message to the next proc in the chain.
    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
}

// ---------------------------------------------------------------- show / z-order / placement

/// Show without activating and put the window at the top of the topmost band.
pub fn show_topmost(raw: isize) {
    // SAFETY: `raw` is the handle of our own live window; called on the main thread.
    unsafe {
        let _ = SetWindowPos(
            hwnd_of(raw),
            Some(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
        );
    }
}

/// Re-assert `HWND_TOPMOST` from any thread. Asynchronous so a busy UI thread can never block
/// the keeper; never activates; never touches the window if it is hidden.
fn reassert_topmost(raw: isize) {
    let hwnd = hwnd_of(raw);
    // SAFETY: plain queries/updates on a window handle; a stale handle just fails.
    unsafe {
        if !IsWindowVisible(hwnd).as_bool() {
            return;
        }
        let _ = SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_ASYNCWINDOWPOS,
        );
    }
}

/// The monitor under the cursor (primary as fallback) and the pill rect for it.
fn target_rect() -> Option<(isize, (i32, i32, u32, u32))> {
    // SAFETY: out-pointers are valid locals; the monitor handle comes straight from the OS.
    unsafe {
        let mut pt = POINT::default();
        GetCursorPos(&mut pt).ok()?;
        let mon: HMONITOR = MonitorFromPoint(pt, MONITOR_DEFAULTTOPRIMARY);
        let mut mi = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(mon, &mut mi).as_bool() {
            return None;
        }
        let (mut dx, mut dy) = (96u32, 96u32);
        let _ = GetDpiForMonitor(mon, MDT_EFFECTIVE_DPI, &mut dx, &mut dy);
        let scale = f64::from(dx.max(96)) / 96.0;
        let wa = mi.rcWork;
        let work = (
            wa.left,
            wa.top,
            (wa.right - wa.left).max(0) as u32,
            (wa.bottom - wa.top).max(0) as u32,
        );
        Some((mon.0 as isize, pill_rect(work, scale)))
    }
}

fn window_rect(hwnd: HWND) -> Option<RECT> {
    let mut r = RECT::default();
    // SAFETY: valid out-pointer.
    unsafe { GetWindowRect(hwnd, &mut r).ok()? };
    Some(r)
}

fn set_rect(hwnd: HWND, (x, y, w, h): (i32, i32, u32, u32), extra: SET_WINDOW_POS_FLAGS) {
    // SAFETY: our own window handle; position/size in physical pixels.
    unsafe {
        let _ = SetWindowPos(
            hwnd,
            None,
            x,
            y,
            w as i32,
            h as i32,
            SWP_NOACTIVATE | SWP_NOZORDER | extra,
        );
    }
}

/// Place the pill bottom-centre on the cursor's monitor in one native call, then once more:
/// crossing a DPI boundary makes the window procedure rescale, so the second call pins the
/// exact rect. Returns the monitor id.
pub fn place_on_cursor_monitor(raw: isize) -> Option<isize> {
    let (mon, rect) = target_rect()?;
    let hwnd = hwnd_of(raw);
    set_rect(hwnd, rect, SET_WINDOW_POS_FLAGS(0));
    if window_rect(hwnd).is_some_and(|r| !matches_rect(&r, rect)) {
        set_rect(hwnd, rect, SET_WINDOW_POS_FLAGS(0));
    }
    Some(mon)
}

fn matches_rect(r: &RECT, (x, y, w, h): (i32, i32, u32, u32)) -> bool {
    r.left == x && r.top == y && (r.right - r.left) == w as i32 && (r.bottom - r.top) == h as i32
}

// ---------------------------------------------------------------- keeper thread

/// Start the keeper: foreground WinEvent hook, periodic z-order re-assert, cursor hover
/// hit-test, cursor-monitor follow while idle, and fullscreen/presentation hiding.
pub fn start_keeper(app: AppHandle) {
    let spawned = std::thread::Builder::new()
        .name("utter-pill-keeper".into())
        .spawn(move || keeper(app));
    if let Err(e) = spawned {
        log::error!("pill keeper failed to start: {e}");
    }
}

fn pill_hwnd(app: &AppHandle) -> Option<isize> {
    app.get_webview_window(PILL_LABEL)?
        .hwnd()
        .ok()
        .map(|h| h.0 as isize)
}

/// WinEvent callback (runs on the keeper thread inside `GetMessageW`): another window took the
/// foreground (taskbar, Start, a topmost app...), so put the pill back on top.
unsafe extern "system" fn on_foreground(
    _hook: HWINEVENTHOOK,
    _event: u32,
    _hwnd: HWND,
    _id_object: i32,
    _id_child: i32,
    _thread: u32,
    _time: u32,
) {
    let raw = HOOK_TARGET.load(Ordering::Relaxed);
    if raw != 0 {
        reassert_topmost(raw);
    }
}

struct Keeper {
    app: AppHandle,
    hwnd: isize,
    /// The window currently ignores the mouse (click-through).
    ignoring: bool,
    /// The cursor is over the capsule (last value emitted as `pill://hover`).
    hover: bool,
    last_monitor: Option<isize>,
    last_reassert: Instant,
    last_follow: Instant,
    last_quns: Instant,
}

fn keeper(app: AppHandle) {
    let Some(hwnd) = pill_hwnd(&app) else {
        log::error!("pill keeper: pill window has no handle");
        return;
    };
    HOOK_TARGET.store(hwnd, Ordering::Relaxed);
    // SAFETY: the hook and timer belong to this thread, which pumps messages below; the
    // callback is a plain function that only reads an atomic. Out-of-context hooks need that
    // message loop to be delivered.
    let hook = unsafe {
        SetWinEventHook(
            EVENT_SYSTEM_FOREGROUND,
            EVENT_SYSTEM_FOREGROUND,
            None,
            Some(on_foreground),
            0,
            0,
            WINEVENT_OUTOFCONTEXT,
        )
    };
    let now = Instant::now();
    let mut k = Keeper {
        app,
        hwnd,
        ignoring: true,
        hover: false,
        last_monitor: None,
        last_reassert: now,
        last_follow: now,
        last_quns: now,
    };
    // SAFETY: thread timer (no window): WM_TIMER is posted to this thread's queue.
    unsafe {
        SetTimer(None, 1, TICK_MS, None);
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).0 > 0 {
            if msg.message == WM_TIMER {
                k.tick();
            } else {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
        if !hook.is_invalid() {
            let _ = UnhookWinEvent(hook);
        }
    }
}

impl Keeper {
    fn tick(&mut self) {
        let Some(st) = self.app.try_state::<Arc<AppState>>() else {
            return;
        };
        let st: Arc<AppState> = st.inner().clone();
        let kind = st.pill.lock().state;
        let hwnd = hwnd_of(self.hwnd);
        let dirty = DIRTY.swap(false, Ordering::Relaxed);

        self.check_fullscreen(&st);

        // SAFETY: plain visibility query on our own window.
        if !unsafe { IsWindowVisible(hwnd) }.as_bool() {
            self.set_hover(false);
            return;
        }
        self.hover_test(hwnd, kind);

        if dirty || self.last_reassert.elapsed() >= REASSERT_EVERY {
            self.last_reassert = Instant::now();
            reassert_topmost(self.hwnd);
        }
        if kind == PillKind::Idle && (dirty || self.last_follow.elapsed() >= FOLLOW_EVERY) {
            self.last_follow = Instant::now();
            self.follow_monitor(hwnd);
        }
    }

    /// Hide the idle pill while a fullscreen app, game or presentation is in front.
    fn check_fullscreen(&mut self, st: &Arc<AppState>) {
        if self.last_quns.elapsed() < QUNS_EVERY {
            return;
        }
        self.last_quns = Instant::now();
        // SAFETY: no arguments; returns the shell's notification state.
        let hide = unsafe { SHQueryUserNotificationState() }
            .map(|s| hide_for_quns(s.0))
            .unwrap_or(false);
        if FULLSCREEN_HIDDEN.swap(hide, Ordering::Relaxed) != hide {
            let cur = st.pill.lock().clone();
            sync_pill(&self.app, &cur, st.pill_allowed());
        }
    }

    /// The window is click-through except over the visible capsule; emit `pill://hover` on
    /// change.
    fn hover_test(&mut self, hwnd: HWND, kind: PillKind) {
        let mut pt = POINT::default();
        // SAFETY: valid out-pointer / our own window.
        let (have_cursor, dpi) = unsafe { (GetCursorPos(&mut pt).is_ok(), GetDpiForWindow(hwnd)) };
        let rect = window_rect(hwnd);
        let inside = match (have_cursor, rect) {
            (true, Some(r)) => capsule_hit(
                (pt.x, pt.y),
                (r.left, r.top),
                f64::from(dpi.max(96)) / 96.0,
                kind,
                self.hover,
            ),
            _ => false,
        };
        if inside == self.ignoring {
            // inside && ignoring -> start receiving the mouse; outside && !ignoring -> pass through.
            self.ignoring = !inside;
            let handle = self.app.clone();
            let ignore = self.ignoring;
            let _ = self.app.run_on_main_thread(move || {
                if let Some(w) = handle.get_webview_window(PILL_LABEL) {
                    let _ = w.set_ignore_cursor_events(ignore);
                }
            });
        }
        self.set_hover(inside);
    }

    fn set_hover(&mut self, hover: bool) {
        if hover != self.hover {
            self.hover = hover;
            let _ = self.app.emit("pill://hover", json!({ "hover": hover }));
        }
    }

    /// While idle, follow the cursor to another monitor, and re-fit after display, DPI or
    /// work-area changes.
    fn follow_monitor(&mut self, hwnd: HWND) {
        let Some((mon, rect)) = target_rect() else {
            return;
        };
        let moved = monitor_changed(self.last_monitor, Some(mon));
        let off = window_rect(hwnd).is_some_and(|r| !matches_rect(&r, rect));
        if moved || off {
            self.last_monitor = Some(mon);
            // Async: this is not the window's thread.
            set_rect(hwnd, rect, SWP_ASYNCWINDOWPOS);
        }
    }
}
