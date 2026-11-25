//! Windows low-level keyboard hook feeding the pure `Matcher`.
//!
//! The hook runs on its own thread with a message loop. The callback only maps VK -> `Key`,
//! ignores injected events, updates the shared matcher under a short lock, decides whether to
//! swallow, and forwards the result over a channel. No I/O besides the mask-key `SendInput`.
#![cfg(target_os = "windows")]

use super::chord::{key_from_vk, Chord, Key};
use super::matcher::{HotkeyEvent, Matcher};
use ::windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use ::windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
    VIRTUAL_KEY,
};
use ::windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, GetMessageW, PostThreadMessageW, SetWindowsHookExW, UnhookWindowsHookEx, HHOOK,
    KBDLLHOOKSTRUCT, MSG, WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP, WM_QUIT, WM_SYSKEYDOWN,
    WM_SYSKEYUP,
};
use anyhow::{anyhow, Result};
use std::collections::BTreeSet;
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::Duration;

const LLKHF_INJECTED: u32 = 0x10;
/// Unassigned virtual key used to "mask" a Win/Alt tap.
const VK_MASK: u16 = 0xE8;
const VK_PACKET: u16 = 0xE7;

/// One physical key event plus whatever hotkey events it produced.
#[derive(Debug, Clone)]
pub struct RawKey {
    pub key: Key,
    pub down: bool,
    pub t_ms: u64,
    pub events: Vec<HotkeyEvent>,
}

struct Capture {
    held: BTreeSet<Key>,
    peak: BTreeSet<Key>,
    done: Sender<Option<Chord>>,
}

struct Ctx {
    matcher: Arc<Mutex<Matcher>>,
    tx: Sender<RawKey>,
    capture: Option<Capture>,
}

static CTX: Mutex<Option<Ctx>> = Mutex::new(None);

fn lock_ctx() -> MutexGuard<'static, Option<Ctx>> {
    CTX.lock().unwrap_or_else(|e| e.into_inner())
}

pub struct HookHandle {
    thread_id: u32,
    join: Option<JoinHandle<()>>,
}

impl HookHandle {
    pub fn stop(mut self) {
        self.shutdown();
    }

    fn shutdown(&mut self) {
        if let Some(j) = self.join.take() {
            // SAFETY: plain thread-message post to our own hook thread.
            unsafe {
                let _ = PostThreadMessageW(self.thread_id, WM_QUIT, WPARAM(0), LPARAM(0));
            }
            let _ = j.join();
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
            matcher,
            tx,
            capture: None,
        });
    }
    let (ready_tx, ready_rx) = mpsc::channel::<Result<u32, String>>();
    let join = std::thread::Builder::new()
        .name("utter-hotkey-hook".into())
        .spawn(move || {
            // SAFETY: standard LL hook install on a thread that pumps messages below.
            let hook = unsafe { SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook_proc), None, 0) };
            let hook = match hook {
                Ok(h) => h,
                Err(e) => {
                    let _ = ready_tx.send(Err(e.to_string()));
                    return;
                }
            };
            let tid = unsafe { ::windows::Win32::System::Threading::GetCurrentThreadId() };
            let _ = ready_tx.send(Ok(tid));
            let mut msg = MSG::default();
            // SAFETY: message loop; exits on WM_QUIT (returns 0) or error (-1).
            unsafe {
                while GetMessageW(&mut msg, None, 0, 0).0 > 0 {}
                let _ = UnhookWindowsHookEx(HHOOK(hook.0));
            }
        })?;
    match ready_rx.recv_timeout(Duration::from_secs(5)) {
        Ok(Ok(thread_id)) => Ok(HookHandle {
            thread_id,
            join: Some(join),
        }),
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

/// Capture mode for the shortcut recorder: swallows all keys (so nothing fires or reaches apps)
/// until the first key is released, and returns the chord of everything held at that moment.
/// Requires a running hook. Returns `None` on timeout or when no hook is running.
pub fn capture_next_chord(timeout: Duration) -> Option<Chord> {
    let (tx, rx) = mpsc::channel();
    {
        let mut ctx = lock_ctx();
        let c = ctx.as_mut()?;
        c.matcher.lock().unwrap_or_else(|e| e.into_inner()).reset();
        c.capture = Some(Capture {
            held: BTreeSet::new(),
            peak: BTreeSet::new(),
            done: tx,
        });
    }
    let out = rx.recv_timeout(timeout).ok().flatten();
    if let Some(c) = lock_ctx().as_mut() {
        c.capture = None;
        c.matcher.lock().unwrap_or_else(|e| e.into_inner()).reset();
    }
    out
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

unsafe extern "system" fn hook_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code < 0 {
        return CallNextHookEx(None, code, wparam, lparam);
    }
    // SAFETY: for WH_KEYBOARD_LL, lparam points to a KBDLLHOOKSTRUCT valid for this call.
    let info = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
    let down = match wparam.0 as u32 {
        WM_KEYDOWN | WM_SYSKEYDOWN => true,
        WM_KEYUP | WM_SYSKEYUP => false,
        _ => return CallNextHookEx(None, code, wparam, lparam),
    };
    let vk = info.vkCode as u16;
    if info.flags.0 & LLKHF_INJECTED != 0 || vk == VK_MASK || vk == VK_PACKET {
        return CallNextHookEx(None, code, wparam, lparam);
    }
    let key = key_from_vk(vk);
    let t_ms = info.time as u64;

    let swallow;
    let mask;
    {
        let mut guard = lock_ctx();
        let Some(ctx) = guard.as_mut() else {
            return CallNextHookEx(None, code, wparam, lparam);
        };
        if let Some(cap) = ctx.capture.as_mut() {
            if down {
                cap.held.insert(key);
                cap.peak.insert(key);
            } else {
                cap.held.remove(&key);
                let chord = Chord::from_keys(cap.peak.iter().copied()).ok();
                let _ = cap.done.send(chord);
                ctx.capture = None;
            }
            return LRESULT(1);
        }
        let (events, sw, mk) = {
            let mut m = ctx.matcher.lock().unwrap_or_else(|e| e.into_inner());
            let events = m.on_key(key, down, t_ms);
            (events, m.should_swallow(key, down), m.take_mask_request())
        };
        swallow = sw;
        mask = mk;
        let _ = ctx.tx.send(RawKey {
            key,
            down,
            t_ms,
            events,
        });
    }
    if mask {
        send_mask_key();
    }
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
