//! Win32 side of the pill overlay: explicit non-activating tool-window styles, a
//! `WM_MOUSEACTIVATE` guard, native placement on the cursor's monitor, and the keeper thread
//! that keeps the pill above everything and click-through except over its capsule.
//!
//! IMPORTANT: after `harden`, the pill is driven natively only (show/hide/click-through/
//! position). Tauri/tao flag setters (`show`, `hide`, `set_ignore_cursor_events`,
//! `set_always_on_top`, ...) go through tao's cached window flags, which believe the pill is
//! hidden (we show it with raw `SetWindowPos`) and would re-write `GWL_EXSTYLE` (dropping
//! `WS_EX_TOOLWINDOW`, adding `WS_EX_APPWINDOW`) and call `ShowWindow(SW_HIDE)`.
//!
//! Threading: style changes, the subclass and show/hide run on the main thread (the keeper
//! marshals them with `run_on_main_thread`). The keeper itself only calls `SetWindowPos` with
//! `SWP_ASYNCWINDOWPOS`, so it can never block on a busy UI thread.

use crate::app_state::{AppState, PillKind};
use crate::windows::{
    capsule_hit, hide_for_quns, hover_transition, menu_expired, monitor_changed, pill_rect,
    sync_pill, FULLSCREEN_HIDDEN, MENU_OPEN, PILL_LABEL,
};
use ::windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use ::windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
use ::windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromPoint, HMONITOR, MONITORINFO, MONITOR_DEFAULTTOPRIMARY,
};
use ::windows::Win32::System::Threading::GetCurrentThreadId;
use ::windows::Win32::UI::Accessibility::{SetWinEventHook, UnhookWinEvent, HWINEVENTHOOK};
use ::windows::Win32::UI::HiDpi::{GetDpiForMonitor, GetDpiForWindow, MDT_EFFECTIVE_DPI};
use ::windows::Win32::UI::Shell::{
    DefSubclassProc, RemoveWindowSubclass, SHQueryUserNotificationState, SetWindowSubclass,
};
use ::windows::Win32::UI::WindowsAndMessaging::{
    DispatchMessageW, GetCursorPos, GetMessageW, GetWindow, GetWindowLongPtrW, GetWindowRect,
    IsWindowVisible, KillTimer, PostThreadMessageW, SetTimer, SetWindowLongPtrW, SetWindowPos,
    TranslateMessage, EVENT_SYSTEM_FOREGROUND, GWL_EXSTYLE, GW_HWNDPREV, HWND_TOPMOST,
    MA_NOACTIVATE, MSG, SET_WINDOW_POS_FLAGS, SWP_ASYNCWINDOWPOS, SWP_FRAMECHANGED, SWP_HIDEWINDOW,
    SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SWP_SHOWWINDOW, WINEVENT_OUTOFCONTEXT,
    WM_APP, WM_DISPLAYCHANGE, WM_DPICHANGED, WM_MOUSEACTIVATE, WM_NCDESTROY, WM_POWERBROADCAST,
    WM_QUIT, WM_SETTINGCHANGE, WM_TIMER, WS_EX_APPWINDOW, WS_EX_LAYERED, WS_EX_NOACTIVATE,
    WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_EX_TRANSPARENT,
};
use serde_json::json;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

/// Heartbeat while the pill is visible: also the cursor hit-test period.
const TICK_VISIBLE_MS: u32 = 60;
/// Heartbeat while the pill is hidden (just enough to notice it was shown again).
const TICK_HIDDEN_MS: u32 = 500;
const REASSERT_EVERY: Duration = Duration::from_millis(1500);
const FOLLOW_EVERY: Duration = Duration::from_millis(500);
const QUNS_EVERY: Duration = Duration::from_millis(500);
const SUBCLASS_ID: usize = 0x5554_5452; // "UTTR"
/// Posted to the keeper thread by the foreground hook: run a tick now.
const WM_KEEPER_WAKE: u32 = WM_APP + 1;
/// Styles the pill must always carry.
const REQUIRED_EX: u32 = WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0 | WS_EX_TOPMOST.0;

/// Win32 id of the keeper thread, for `stop_keeper`; 0 = not running.
static KEEPER_TID: AtomicU32 = AtomicU32::new(0);
/// Set by the subclass when the display, DPI, work area or power state changed; the keeper
/// then re-places and re-asserts at its next heartbeat instead of waiting for a timer.
static DIRTY: AtomicBool = AtomicBool::new(false);
/// Set by the foreground hook: another window took the foreground since the last tick.
static FOREGROUND_CHANGED: AtomicBool = AtomicBool::new(false);

fn hwnd_of(raw: isize) -> HWND {
    HWND(raw as *mut _)
}

// ---------------------------------------------------------------- window styles / visibility

/// Give the pill explicit tool-window / no-activate / topmost styles, start it click-through
/// and guard against activation by mouse. Must run on the thread that owns the window (the
/// main thread), while the window is still hidden so the taskbar/Alt-Tab change takes effect
/// cleanly.
pub fn harden(w: &WebviewWindow) {
    let Ok(h) = w.hwnd() else { return };
    let hwnd = hwnd_of(h.0 as isize);
    apply_ex_style(hwnd, |ex| {
        (ex | REQUIRED_EX | click_through_bits()) & !WS_EX_APPWINDOW.0
    });
    // SAFETY: our own live window, on its owning thread. Best effort: a failure only means
    // hover-activation is not blocked.
    unsafe {
        let _ = SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, 0);
    }
}

fn click_through_bits() -> u32 {
    WS_EX_TRANSPARENT.0 | WS_EX_LAYERED.0
}

/// Read-modify-write `GWL_EXSTYLE` and make it take effect (`SWP_FRAMECHANGED`).
fn apply_ex_style(hwnd: HWND, f: impl FnOnce(u32) -> u32) {
    // SAFETY: our own window handle; the style word is a plain integer.
    unsafe {
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, f(ex) as isize);
        let _ = SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_FRAMECHANGED,
        );
    }
}

/// Toggle click-through the way tao does (`WS_EX_TRANSPARENT | WS_EX_LAYERED`), without going
/// through tao so its cached flags never get re-applied. Main thread.
pub fn set_click_through(raw: isize, on: bool) {
    apply_ex_style(hwnd_of(raw), |ex| {
        if on {
            ex | click_through_bits()
        } else {
            ex & !click_through_bits()
        }
    });
}

/// Re-apply the required styles if anything stripped them. Main thread. Returns true when it
/// had to repair.
pub fn ensure_styles(raw: isize) -> bool {
    let hwnd = hwnd_of(raw);
    // SAFETY: plain style read on our own window.
    let ex = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) } as u32;
    if ex & REQUIRED_EX == REQUIRED_EX && ex & WS_EX_APPWINDOW.0 == 0 {
        return false;
    }
    apply_ex_style(hwnd, |ex| (ex | REQUIRED_EX) & !WS_EX_APPWINDOW.0);
    true
}

/// Show without activating and put the window at the top of the topmost band. Main thread.
pub fn show_topmost(raw: isize) {
    // SAFETY: the handle of our own live window.
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

/// Hide natively (tao thinks the pill is already hidden, so `w.hide()` would do nothing).
pub fn hide(raw: isize) {
    // SAFETY: the handle of our own live window.
    unsafe {
        let _ = SetWindowPos(
            hwnd_of(raw),
            None,
            0,
            0,
            0,
            0,
            SWP_HIDEWINDOW | SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER,
        );
    }
}

pub fn is_visible(raw: isize) -> bool {
    // SAFETY: plain query.
    unsafe { IsWindowVisible(hwnd_of(raw)) }.as_bool()
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

// ---------------------------------------------------------------- z-order / placement

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

fn rects_overlap(a: &RECT, b: &RECT) -> bool {
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}

/// Does this window really sit visibly above the pill? Hidden, DWM-cloaked (virtual-desktop
/// or suspended UWP ghosts) and click-through overlay windows do not count.
fn counts_as_cover(hwnd: HWND) -> bool {
    // SAFETY: plain queries; `cloaked` is a valid 4-byte out-buffer for DWMWA_CLOAKED.
    unsafe {
        if !IsWindowVisible(hwnd).as_bool() {
            return false;
        }
        let mut cloaked = 0u32;
        let _ = DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED,
            (&mut cloaked as *mut u32).cast(),
            std::mem::size_of::<u32>() as u32,
        );
        if cloaked != 0 {
            return false;
        }
        GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32 & WS_EX_TRANSPARENT.0 == 0
    }
}

/// Is a visible window above the pill in the z-order overlapping the pill's rect?
fn is_covered(hwnd: HWND) -> bool {
    let Some(mine) = window_rect(hwnd) else {
        return false;
    };
    let mut cur = hwnd;
    // Bounded walk: a pathological z-order must not stall the keeper.
    for _ in 0..512 {
        // SAFETY: z-order query; an Err means we reached the top.
        let Ok(prev) = (unsafe { GetWindow(cur, GW_HWNDPREV) }) else {
            return false;
        };
        if prev.0.is_null() {
            return false;
        }
        cur = prev;
        if counts_as_cover(cur) && window_rect(cur).is_some_and(|r| rects_overlap(&r, &mine)) {
            return true;
        }
    }
    false
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

fn matches_rect(r: &RECT, (x, y, w, h): (i32, i32, u32, u32)) -> bool {
    r.left == x && r.top == y && (r.right - r.left) == w as i32 && (r.bottom - r.top) == h as i32
}

/// Place the pill bottom-centre on the cursor's monitor in one native call, then once more:
/// crossing a DPI boundary makes the window procedure rescale, so the second call pins the
/// exact rect. Main thread. Returns the monitor id.
pub fn place_on_cursor_monitor(raw: isize) -> Option<isize> {
    let (mon, rect) = target_rect()?;
    let hwnd = hwnd_of(raw);
    set_rect(hwnd, rect, SET_WINDOW_POS_FLAGS(0));
    if window_rect(hwnd).is_some_and(|r| !matches_rect(&r, rect)) {
        set_rect(hwnd, rect, SET_WINDOW_POS_FLAGS(0));
    }
    Some(mon)
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

/// Ask the keeper to leave its message loop (it unhooks and kills its timer on the way out).
pub fn stop_keeper() {
    let tid = KEEPER_TID.load(Ordering::Relaxed);
    if tid != 0 {
        // SAFETY: posting a quit message to a thread id we recorded; a stale id just fails.
        unsafe {
            let _ = PostThreadMessageW(tid, WM_QUIT, WPARAM(0), LPARAM(0));
        }
    }
}

/// Run a keeper tick now (used right after the pill is shown, so hover/retiming do not wait for
/// the slow hidden-state heartbeat).
pub fn wake_keeper() {
    let tid = KEEPER_TID.load(Ordering::Relaxed);
    if tid != 0 {
        // SAFETY: posting to a recorded thread id; a stale id just fails.
        unsafe {
            let _ = PostThreadMessageW(tid, WM_KEEPER_WAKE, WPARAM(0), LPARAM(0));
        }
    }
}

fn pill_hwnd(app: &AppHandle) -> Option<isize> {
    app.get_webview_window(PILL_LABEL)?
        .hwnd()
        .ok()
        .map(|h| h.0 as isize)
}

/// WinEvent callback (runs on the keeper thread inside `GetMessageW`): another window took the
/// foreground (taskbar, Start, a topmost app...). Only flags it and wakes the keeper, which
/// decides on its next tick whether the pill is still meant to be visible.
unsafe extern "system" fn on_foreground(
    _hook: HWINEVENTHOOK,
    _event: u32,
    _hwnd: HWND,
    _id_object: i32,
    _id_child: i32,
    _thread: u32,
    _time: u32,
) {
    FOREGROUND_CHANGED.store(true, Ordering::Relaxed);
    // SAFETY: posts to this very thread (the callback runs on the keeper thread).
    unsafe {
        let _ = PostThreadMessageW(GetCurrentThreadId(), WM_KEEPER_WAKE, WPARAM(0), LPARAM(0));
    }
}

struct Keeper {
    app: AppHandle,
    hwnd: isize,
    /// Id of the thread timer (returned by `SetTimer`; passing it back re-arms that timer).
    timer: usize,
    timer_ms: u32,
    /// The window currently ignores the mouse (click-through).
    ignoring: bool,
    /// The cursor is over the hit rect (last value emitted as `pill://hover`).
    hover: bool,
    last_monitor: Option<isize>,
    last_reassert: Instant,
    last_follow: Instant,
    last_quns: Instant,
    /// Since when the cursor has been outside the open menu (for the latch expiry).
    menu_outside_since: Option<Instant>,
}

fn keeper(app: AppHandle) {
    let Some(hwnd) = pill_hwnd(&app) else {
        log::error!("pill keeper: pill window has no handle");
        return;
    };
    // SAFETY: the hook and timer belong to this thread, which pumps messages below; the
    // callback only touches atomics and posts to this thread. Out-of-context hooks are
    // delivered through that message loop.
    unsafe {
        KEEPER_TID.store(GetCurrentThreadId(), Ordering::Relaxed);
        let hook = SetWinEventHook(
            EVENT_SYSTEM_FOREGROUND,
            EVENT_SYSTEM_FOREGROUND,
            None,
            Some(on_foreground),
            0,
            0,
            WINEVENT_OUTOFCONTEXT,
        );
        let now = Instant::now();
        let mut k = Keeper {
            app,
            hwnd,
            timer: 0,
            timer_ms: TICK_HIDDEN_MS,
            ignoring: true,
            hover: false,
            last_monitor: None,
            last_reassert: now,
            last_follow: now,
            last_quns: now,
            menu_outside_since: None,
        };
        k.timer = SetTimer(None, 0, k.timer_ms, None);
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).0 > 0 {
            match msg.message {
                WM_TIMER | WM_KEEPER_WAKE => k.tick(),
                _ => {
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            }
        }
        // Left the loop (WM_QUIT): tidy up.
        let _ = KillTimer(None, k.timer);
        if !hook.is_invalid() {
            let _ = UnhookWinEvent(hook);
        }
        KEEPER_TID.store(0, Ordering::Relaxed);
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
        let foreground = FOREGROUND_CHANGED.swap(false, Ordering::Relaxed);

        // Fullscreen first, so a foreground change into a game hides the pill instead of
        // fighting it. Skipped entirely when the pill is switched off or hidden for an hour.
        if st.pill_allowed(kind) {
            self.check_fullscreen(&st, foreground);
        }

        let visible = is_visible(self.hwnd);
        self.retime(visible);
        if !visible {
            self.set_hover(false);
            return;
        }
        self.hover_test(hwnd, kind);

        // A foreground change re-asserts unconditionally; the periodic pass only when
        // something visible actually sits above the pill.
        let periodic = self.last_reassert.elapsed() >= REASSERT_EVERY;
        if foreground || dirty || (periodic && is_covered(hwnd)) {
            reassert_topmost(self.hwnd);
        }
        if periodic {
            self.last_reassert = Instant::now();
            self.repair_styles();
        }
        if kind == PillKind::Idle && (dirty || self.last_follow.elapsed() >= FOLLOW_EVERY) {
            self.last_follow = Instant::now();
            self.follow_monitor(hwnd);
        }
    }

    /// 60 ms while the pill is visible, 500 ms while it is hidden.
    fn retime(&mut self, visible: bool) {
        let want = if visible {
            TICK_VISIBLE_MS
        } else {
            TICK_HIDDEN_MS
        };
        if want != self.timer_ms {
            self.timer_ms = want;
            // SAFETY: passing the id `SetTimer` returned re-arms the same thread timer.
            self.timer = unsafe { SetTimer(None, self.timer, want, None) };
        }
    }

    /// Hide the idle pill while a fullscreen app, game or presentation is in front.
    fn check_fullscreen(&mut self, st: &Arc<AppState>, force: bool) {
        if !force && self.last_quns.elapsed() < QUNS_EVERY {
            return;
        }
        self.last_quns = Instant::now();
        // SAFETY: no arguments; returns the shell's notification state.
        let hide = unsafe { SHQueryUserNotificationState() }
            .map(|s| hide_for_quns(s.0))
            .unwrap_or(false);
        if FULLSCREEN_HIDDEN.swap(hide, Ordering::Relaxed) != hide {
            let cur = st.pill.lock().clone();
            sync_pill(&self.app, &cur, st.pill_allowed(cur.state));
        }
    }

    /// Put back WS_EX_TOOLWINDOW/NOACTIVATE/TOPMOST if anything stripped them (main thread).
    fn repair_styles(&self) {
        let raw = self.hwnd;
        let _ = self.app.run_on_main_thread(move || {
            ensure_styles(raw);
        });
    }

    /// The window is click-through except over the visible capsule (or the open menu); emit
    /// `pill://hover` on change.
    fn hover_test(&mut self, hwnd: HWND, kind: PillKind) {
        let mut pt = POINT::default();
        // SAFETY: valid out-pointer / our own window.
        let (have_cursor, dpi) = unsafe { (GetCursorPos(&mut pt).is_ok(), GetDpiForWindow(hwnd)) };
        let inside = match (have_cursor, window_rect(hwnd)) {
            (true, Some(r)) => capsule_hit(
                (pt.x, pt.y),
                (r.left, r.top),
                f64::from(dpi.max(96)) / 96.0,
                kind,
                self.hover,
                MENU_OPEN.load(Ordering::Relaxed),
            ),
            _ => false,
        };
        self.expire_menu(inside);
        let (ignore, emit) = hover_transition(self.ignoring, self.hover, inside);
        if let Some(ignore) = ignore {
            self.ignoring = ignore;
            let raw = self.hwnd;
            let _ = self.app.run_on_main_thread(move || {
                set_click_through(raw, ignore);
            });
        }
        if let Some(h) = emit {
            self.hover = h;
            let _ = self.app.emit("pill://hover", json!({ "hover": h }));
        }
    }

    /// Drop the menu latch once the cursor has stayed outside the menu rect for too long.
    fn expire_menu(&mut self, inside: bool) {
        if !MENU_OPEN.load(Ordering::Relaxed) || inside {
            self.menu_outside_since = None;
            return;
        }
        let since = *self.menu_outside_since.get_or_insert_with(Instant::now);
        if menu_expired(since.elapsed().as_millis() as u64) {
            MENU_OPEN.store(false, Ordering::Relaxed);
            self.menu_outside_since = None;
        }
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
