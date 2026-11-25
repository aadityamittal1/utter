//! Windows low-level keyboard hook feeding the pure `Matcher`.
//!
//! The hook runs on its own thread with a message loop. The callback only maps VK -> `Key`,
//! ignores injected events, updates the shared matcher under a short lock, decides whether to
//! swallow, and forwards the result over a channel. No I/O besides the mask-key `SendInput`.
#![cfg(target_os = "windows")]

use super::chord::{key_from_vk, Chord, Key};
use super::matcher::{HotkeyEvent, Matcher};
use ::windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use ::windows::Win32::System::Threading::{
    GetCurrentThread, SetThreadPriority, THREAD_PRIORITY_TIME_CRITICAL,
};
use ::windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS,
    KEYEVENTF_KEYUP, VIRTUAL_KEY,
};
use ::windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, GetMessageW, PeekMessageW, PostThreadMessageW, SetWindowsHookExW,
    UnhookWindowsHookEx, KBDLLHOOKSTRUCT, MSG, PM_NOREMOVE, WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP,
    WM_QUIT, WM_SYSKEYDOWN, WM_SYSKEYUP, WM_USER,
};
use anyhow::{anyhow, Result};
use std::collections::BTreeSet;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

const LLKHF_INJECTED: u32 = 0x10;
/// Unassigned virtual key used to "mask" a Win/Alt tap.
const VK_MASK: u16 = 0xE8;
const VK_PACKET: u16 = 0xE7;
/// Thread message asking the hook thread to remove and re-install the hook.
const WM_REHOOK: u32 = WM_USER + 1;

// ---- watchdog ----
//
// Windows silently removes a low-level hook whose callback exceeds LowLevelHooksTimeout (seen
// under heavy CPU load). A watchdog notices that modifiers are physically held while the hook
// saw no event, and re-installs it.

const WATCHDOG_POLL: Duration = Duration::from_millis(100);
/// Keys of a bound modifier-only chord held this long with a silent hook = hook is dead.
const HELD_THRESHOLD: Duration = Duration::from_millis(400);
/// Allowance for the poll interval when comparing the hold start with the last hook event.
const POLL_SLACK: Duration = Duration::from_millis(150);
/// Re-install the hook this often while no modifier is held (cheap insurance).
const PERIODIC_REHOOK: Duration = Duration::from_secs(60);
/// A watchdog tick this late means the machine slept or stalled: re-install.
const STALL_GAP: Duration = Duration::from_secs(5);

/// Milliseconds since epoch() of the last event the hook callback saw.
static LAST_EVENT_MS: AtomicU64 = AtomicU64::new(0);
static HOOK_INSTALLED: AtomicBool = AtomicBool::new(false);

fn epoch() -> Instant {
    static EPOCH: OnceLock<Instant> = OnceLock::new();
    *EPOCH.get_or_init(Instant::now)
}

fn note_event() {
    LAST_EVENT_MS.store(epoch().elapsed().as_millis() as u64, Ordering::Relaxed);
}

fn last_event_age() -> Duration {
    let now = epoch().elapsed().as_millis() as u64;
    Duration::from_millis(now.saturating_sub(LAST_EVENT_MS.load(Ordering::Relaxed)))
}

/// The hook is presumed removed when a chord has been physically held past the threshold
/// but the hook has seen nothing since before the hold began.
pub fn should_rehook(held_for: Option<Duration>, last_event_age: Duration) -> bool {
    match held_for {
        Some(h) if h >= HELD_THRESHOLD => last_event_age > h + POLL_SLACK,
        _ => false,
    }
}

/// Routine re-install: only when no modifier is held, at most once per period.
pub fn periodic_rehook_due(since_last_rehook: Duration, any_modifier_down: bool) -> bool {
    !any_modifier_down && since_last_rehook >= PERIODIC_REHOOK
}

/// One physical key event that produced hotkey events (events are never empty).
#[derive(Debug, Clone)]
pub struct RawKey {
    pub key: Key,
    pub down: bool,
    pub t_ms: u64,
    pub events: Vec<HotkeyEvent>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum CaptureError {
    #[error("no keyboard hook is running")]
    NoHook,
    #[error("a capture is already in progress")]
    AlreadyCapturing,
    #[error("timed out waiting for a shortcut")]
    Timeout,
    #[error("capture cancelled")]
    Cancelled,
    #[error("that key combination is not a valid shortcut")]
    InvalidChord,
}

type CaptureResult = Result<Chord, CaptureError>;

/// What the hook should do with a key event during capture.
#[derive(Debug, PartialEq, Eq)]
enum CaptureStep {
    Swallow,
    Pass,
    Done(CaptureResult),
}

/// Pure capture state: chord = keys held at the moment the first captured key is released.
#[derive(Debug, Default)]
struct Capture {
    held: BTreeSet<Key>,
    peak: BTreeSet<Key>,
    /// Keys whose key-down we swallowed (their key-up must be swallowed too, and only those).
    swallowed_downs: BTreeSet<Key>,
}

impl Capture {
    fn on_key(&mut self, key: Key, down: bool) -> CaptureStep {
        if down {
            self.held.insert(key);
            self.peak.insert(key);
            self.swallowed_downs.insert(key);
            return CaptureStep::Swallow;
        }
        if !self.swallowed_downs.remove(&key) {
            return CaptureStep::Pass; // was already down before capture began
        }
        self.held.remove(&key);
        let res =
            Chord::from_keys(self.peak.iter().copied()).map_err(|_| CaptureError::InvalidChord);
        CaptureStep::Done(res)
    }
}

struct CaptureSlot {
    state: Capture,
    done: Sender<CaptureResult>,
}

/// Unwraps the u32 millisecond tick (wraps every ~49.7 days) into a monotonic u64.
#[derive(Debug, Default)]
struct Clock {
    last: Option<u32>,
    t: u64,
}

impl Clock {
    fn advance(&mut self, t32: u32) -> u64 {
        self.t = match self.last {
            None => t32 as u64,
            Some(l) => self.t + t32.wrapping_sub(l) as u64,
        };
        self.last = Some(t32);
        self.t
    }
}

struct Ctx {
    matcher: Arc<Mutex<Matcher>>,
    tx: Sender<RawKey>,
    capture: Option<CaptureSlot>,
    /// Keys whose down was swallowed by an ended capture; their key-up is swallowed once.
    stale_ups: BTreeSet<Key>,
    clock: Clock,
}

static CTX: Mutex<Option<Ctx>> = Mutex::new(None);

fn lock_ctx() -> MutexGuard<'static, Option<Ctx>> {
    CTX.lock().unwrap_or_else(|e| e.into_inner())
}

pub struct HookHandle {
    thread_id: u32,
    join: Option<JoinHandle<()>>,
    stop: Arc<AtomicBool>,
    watchdog: Option<JoinHandle<()>>,
}

impl HookHandle {
    pub fn stop(mut self) {
        self.shutdown();
    }

    fn shutdown(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(w) = self.watchdog.take() {
            let _ = w.join();
        }
        if let Some(j) = self.join.take() {
            // SAFETY: plain thread-message post to our own hook thread (its queue exists: it is
            // created before the thread signals ready).
            let posted =
                unsafe { PostThreadMessageW(self.thread_id, WM_QUIT, WPARAM(0), LPARAM(0)) }
                    .is_ok();
            if posted {
                let _ = j.join();
            } else {
                // Don't risk blocking forever; the detached thread passes keys through once
                // the context is cleared.
                eprintln!("utter: could not post WM_QUIT to the hotkey hook thread; detaching");
                drop(j);
            }
            *lock_ctx() = None;
        }
    }
}

impl Drop for HookHandle {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// Install the hook on a dedicated thread. Only one hook may be active at a time.
pub fn start_hook(matcher: Arc<Mutex<Matcher>>, tx: Sender<RawKey>) -> Result<HookHandle> {
    {
        let mut ctx = lock_ctx();
        if ctx.is_some() {
            return Err(anyhow!("keyboard hook already running"));
        }
        *ctx = Some(Ctx {
            matcher: matcher.clone(),
            tx: tx.clone(),
            capture: None,
            stale_ups: BTreeSet::new(),
            clock: Clock::default(),
        });
    }
    let (ready_tx, ready_rx) = mpsc::channel::<Result<u32, String>>();
    let join = std::thread::Builder::new()
        .name("utter-hotkey-hook".into())
        .spawn(move || {
            let mut msg = MSG::default();
            // Be scheduled promptly even when every core is busy: a slow callback gets the hook
            // removed by Windows.
            // SAFETY: plain priority change of the current thread.
            unsafe {
                let _ = SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_TIME_CRITICAL);
            }
            // SAFETY: standard LL hook install on a thread that pumps messages below. The
            // PeekMessageW call forces creation of this thread's message queue before we
            // report ready, so PostThreadMessageW(WM_QUIT) cannot fail for lack of a queue.
            let hook = unsafe {
                let _ = PeekMessageW(&mut msg, None, WM_USER, WM_USER, PM_NOREMOVE);
                SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook_proc), None, 0)
            };
            let hook = match hook {
                Ok(h) => h,
                Err(e) => {
                    let _ = ready_tx.send(Err(e.to_string()));
                    return;
                }
            };
            let tid = unsafe { ::windows::Win32::System::Threading::GetCurrentThreadId() };
            note_event();
            HOOK_INSTALLED.store(true, Ordering::Relaxed);
            let _ = ready_tx.send(Ok(tid));
            let mut hook = Some(hook);
            // SAFETY: message loop; exits on WM_QUIT (returns 0) or error (-1).
            unsafe {
                while GetMessageW(&mut msg, None, 0, 0).0 > 0 {
                    if msg.message == WM_REHOOK {
                        if let Some(h) = hook.take() {
                            let _ = UnhookWindowsHookEx(h);
                        }
                        hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook_proc), None, 0).ok();
                        HOOK_INSTALLED.store(hook.is_some(), Ordering::Relaxed);
                        if hook.is_none() {
                            log::error!("keyboard hook re-install failed");
                        }
                    }
                }
                if let Some(h) = hook.take() {
                    let _ = UnhookWindowsHookEx(h);
                }
                HOOK_INSTALLED.store(false, Ordering::Relaxed);
            }
        })?;
    match ready_rx.recv_timeout(Duration::from_secs(5)) {
        Ok(Ok(thread_id)) => {
            let stop = Arc::new(AtomicBool::new(false));
            let watchdog = {
                let stop = stop.clone();
                std::thread::Builder::new()
                    .name("utter-hotkey-watchdog".into())
                    .spawn(move || watchdog(thread_id, matcher, tx, stop))
                    .ok()
            };
            Ok(HookHandle {
                thread_id,
                join: Some(join),
                stop,
                watchdog,
            })
        }
        Ok(Err(e)) => {
            *lock_ctx() = None;
            Err(anyhow!("SetWindowsHookExW failed: {e}"))
        }
        Err(_) => {
            *lock_ctx() = None;
            Err(anyhow!("keyboard hook thread did not start"))
        }
    }
}

fn post_rehook(thread_id: u32) {
    // SAFETY: plain thread-message post to our own hook thread.
    let _ = unsafe { PostThreadMessageW(thread_id, WM_REHOOK, WPARAM(0), LPARAM(0)) };
}

fn watchdog(
    thread_id: u32,
    matcher: Arc<Mutex<Matcher>>,
    tx: Sender<RawKey>,
    stop: Arc<AtomicBool>,
) {
    let mut held_since: Option<Instant> = None;
    let mut last_rehook = Instant::now();
    let mut last_tick = Instant::now();
    while !stop.load(Ordering::Relaxed) {
        std::thread::sleep(WATCHDOG_POLL);
        let now = Instant::now();
        let gap = now.duration_since(last_tick);
        last_tick = now;
        let chords = matcher
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .modifier_only_chords();
        let held = chords
            .iter()
            .any(|c| !c.is_empty() && c.iter().all(|&k| key_is_down(k)));
        if held {
            held_since.get_or_insert(now);
        } else {
            held_since = None;
        }
        let held_for = held_since.map(|s| now.duration_since(s));
        if should_rehook(held_for, last_event_age()) {
            log::warn!("keyboard hook was removed by Windows; reinstalled");
            let events = matcher.lock().unwrap_or_else(|e| e.into_inner()).reset();
            if !events.is_empty() {
                let _ = tx.send(RawKey {
                    key: Key::Ctrl,
                    down: false,
                    t_ms: 0,
                    events,
                });
            }
            note_event();
            post_rehook(thread_id);
            last_rehook = now;
            continue;
        }
        let any_mod = [Key::Ctrl, Key::Win, Key::Alt, Key::Shift]
            .into_iter()
            .any(key_is_down);
        if gap >= STALL_GAP
            || periodic_rehook_due(now.duration_since(last_rehook), any_mod)
            || (!HOOK_INSTALLED.load(Ordering::Relaxed) && !any_mod)
        {
            post_rehook(thread_id);
            last_rehook = now;
        }
    }
}

/// Capture mode for the shortcut recorder: swallows keys pressed from now on (so nothing fires or
/// reaches apps) until the first of them is released, and returns everything held at that moment.
/// Keys already down when capture starts are never swallowed on release.
/// Ends early with `Cancelled` via [`cancel_capture`].
pub fn capture_next_chord(timeout: Duration) -> Result<Chord, CaptureError> {
    let (tx, rx) = mpsc::channel();
    {
        let mut guard = lock_ctx();
        let ctx = guard.as_mut().ok_or(CaptureError::NoHook)?;
        if ctx.capture.is_some() {
            return Err(CaptureError::AlreadyCapturing);
        }
        let _ = ctx
            .matcher
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .reset();
        ctx.capture = Some(CaptureSlot {
            state: Capture::default(),
            done: tx,
        });
    }
    let out = rx
        .recv_timeout(timeout)
        .unwrap_or(Err(CaptureError::Timeout));
    end_capture(None);
    out
}

/// Abort an in-progress `capture_next_chord` (the waiter gets `Err(Cancelled)`).
pub fn cancel_capture() {
    end_capture(Some(CaptureError::Cancelled));
}

fn end_capture(notify: Option<CaptureError>) {
    let mut guard = lock_ctx();
    if let Some(ctx) = guard.as_mut() {
        if let Some(slot) = ctx.capture.take() {
            ctx.stale_ups
                .extend(slot.state.swallowed_downs.iter().copied());
            if let Some(e) = notify {
                let _ = slot.done.send(Err(e));
            }
        }
        let _ = ctx
            .matcher
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .reset();
    }
}

fn send_mask_key() {
    let key = |flags: KEYBD_EVENT_FLAGS| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VIRTUAL_KEY(VK_MASK),
                wScan: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    let inputs = [key(KEYBD_EVENT_FLAGS(0)), key(KEYEVENTF_KEYUP)];
    // SAFETY: valid INPUT array; the events are flagged injected so our hook ignores them.
    unsafe {
        SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
    }
}

/// Physical state of a side-agnostic key via `GetAsyncKeyState`.
fn key_is_down(key: Key) -> bool {
    let vks: &[u16] = match key {
        Key::Ctrl => &[0xA2, 0xA3],
        Key::Win => &[0x5B, 0x5C],
        Key::Alt => &[0xA4, 0xA5],
        Key::Shift => &[0xA0, 0xA1],
        Key::Vk(_) => &[],
    };
    let down = |vk: u16| unsafe { GetAsyncKeyState(vk as i32) } < 0;
    match key {
        Key::Vk(vk) => down(vk),
        _ => vks.iter().any(|&vk| down(vk)),
    }
}

/// Core of the hook callback. Returns true to swallow the event.
fn process(vk: u16, flags: u32, time: u32, down: bool) -> bool {
    if flags & LLKHF_INJECTED != 0 || vk == VK_MASK || vk == VK_PACKET {
        return false;
    }
    let key = key_from_vk(vk);
    let mask;
    let swallow;
    {
        let mut guard = lock_ctx();
        let Some(ctx) = guard.as_mut() else {
            return false;
        };
        let t_ms = ctx.clock.advance(time);
        if let Some(slot) = ctx.capture.as_mut() {
            return match slot.state.on_key(key, down) {
                CaptureStep::Pass => false,
                CaptureStep::Swallow => true,
                CaptureStep::Done(res) => {
                    if let Some(slot) = ctx.capture.take() {
                        ctx.stale_ups
                            .extend(slot.state.swallowed_downs.iter().copied());
                        let _ = slot.done.send(res);
                    }
                    true
                }
            };
        }
        if down {
            ctx.stale_ups.remove(&key);
        } else if ctx.stale_ups.remove(&key) {
            return true; // orphaned key-up of a key whose down a capture swallowed
        }
        let mut events = Vec::new();
        {
            let mut m = ctx.matcher.lock().unwrap_or_else(|e| e.into_inner());
            if down {
                // Self-heal keys whose key-up we never saw (Win+L, Ctrl+Alt+Del, UAC, sleep).
                events.extend(m.prune(|k| k == key || key_is_down(k), t_ms));
            }
            events.extend(m.on_key(key, down, t_ms));
            swallow = m.should_swallow(key, down);
            mask = m.take_mask_request() || m.mask_before_up();
        }
        if !events.is_empty() {
            let _ = ctx.tx.send(RawKey {
                key,
                down,
                t_ms,
                events,
            });
        }
    }
    if mask {
        send_mask_key();
    }
    swallow
}

unsafe extern "system" fn hook_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code < 0 {
        return CallNextHookEx(None, code, wparam, lparam);
    }
    note_event();
    // SAFETY: for WH_KEYBOARD_LL, lparam points to a KBDLLHOOKSTRUCT valid for this call.
    let (vk, flags, time) = {
        let info = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
        (info.vkCode as u16, info.flags.0, info.time)
    };
    let down = match wparam.0 as u32 {
        WM_KEYDOWN | WM_SYSKEYDOWN => Some(true),
        WM_KEYUP | WM_SYSKEYUP => Some(false),
        _ => None,
    };
    let swallow = match down {
        // A panic must never take the keyboard down: pass the key through.
        Some(d) => catch_unwind(AssertUnwindSafe(|| process(vk, flags, time, d))).unwrap_or(false),
        None => false,
    };
    if swallow {
        return LRESULT(1);
    }
    CallNextHookEx(None, code, wparam, lparam)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hotkeys::matcher::default_bindings;
    use std::time::Instant;

    const CTRL: Key = Key::Ctrl;
    const WIN: Key = Key::Win;

    #[test]
    fn capture_returns_peak_chord_on_first_release() {
        let mut c = Capture::default();
        assert_eq!(c.on_key(CTRL, true), CaptureStep::Swallow);
        assert_eq!(c.on_key(WIN, true), CaptureStep::Swallow);
        assert_eq!(c.on_key(Key::Vk(0x20), true), CaptureStep::Swallow);
        assert_eq!(
            c.on_key(Key::Vk(0x20), false),
            CaptureStep::Done(Ok(Chord::parse("Ctrl+Win+Space").unwrap()))
        );
    }

    #[test]
    fn capture_never_swallows_up_of_key_held_before_capture() {
        let mut c = Capture::default();
        assert_eq!(c.on_key(Key::Vk(0x0D), false), CaptureStep::Pass); // Enter from the click
        assert_eq!(c.on_key(CTRL, true), CaptureStep::Swallow);
        assert_eq!(
            c.on_key(CTRL, false),
            CaptureStep::Done(Ok(Chord::parse("Ctrl").unwrap()))
        );
    }

    #[test]
    fn capture_invalid_chord_is_not_a_timeout() {
        let mut c = Capture::default();
        c.on_key(Key::Vk(0x41), true);
        c.on_key(Key::Vk(0x42), true);
        assert_eq!(
            c.on_key(Key::Vk(0x42), false),
            CaptureStep::Done(Err(CaptureError::InvalidChord))
        );
    }

    #[test]
    fn rehook_needs_a_long_hold_and_a_silent_hook() {
        let ms = Duration::from_millis;
        // Not held, or held briefly: never.
        assert!(!should_rehook(None, ms(60_000)));
        assert!(!should_rehook(Some(ms(399)), ms(60_000)));
        // Held long, hook saw the key-down (event age ~ hold time): healthy.
        assert!(!should_rehook(Some(ms(400)), ms(450)));
        assert!(!should_rehook(Some(ms(5_000)), ms(5_100)));
        assert!(!should_rehook(Some(ms(500)), ms(10)));
        // Held long, hook silent since long before the hold began: dead.
        assert!(should_rehook(Some(ms(400)), ms(2_000)));
        assert!(should_rehook(Some(ms(450)), ms(10_000)));
    }

    #[test]
    fn periodic_rehook_waits_for_idle_keys() {
        assert!(!periodic_rehook_due(Duration::from_secs(59), false));
        assert!(!periodic_rehook_due(Duration::from_secs(120), true));
        assert!(periodic_rehook_due(Duration::from_secs(60), false));
    }

    #[test]
    fn clock_unwraps_u32_millisecond_wraparound() {
        let mut c = Clock::default();
        assert_eq!(c.advance(u32::MAX - 10), (u32::MAX - 10) as u64);
        let t = c.advance(5);
        assert_eq!(t, (u32::MAX - 10) as u64 + 16);
        assert_eq!(c.advance(105), t + 100);
    }

    /// Manual: run `cargo test --lib print_hotkey_events -- --ignored --nocapture`, then press
    /// the default shortcuts for 15 seconds.
    #[test]
    #[ignore]
    fn print_hotkey_events() {
        let matcher = Arc::new(Mutex::new(Matcher::new(default_bindings())));
        matcher.lock().unwrap().set_recording(true);
        let (tx, rx) = mpsc::channel();
        let hook = start_hook(matcher, tx).expect("hook");
        let end = Instant::now() + Duration::from_secs(15);
        println!("Press hotkeys for 15 s (Esc is live: recording=true)...");
        while let Some(left) = end.checked_duration_since(Instant::now()) {
            if let Ok(raw) = rx.recv_timeout(left) {
                println!(
                    "{:>10} {:?} {} {:?}",
                    raw.t_ms,
                    raw.key,
                    if raw.down { "down" } else { "up" },
                    raw.events
                );
            }
        }
        hook.stop();
    }
}
