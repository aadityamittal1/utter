//! Keystroke injection (SendInput), paste, and selection capture.

use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use ::windows::Win32::Foundation::HWND;
use ::windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
use ::windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS,
    KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, VIRTUAL_KEY,
};
use ::windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetWindowThreadProcessId, IsWindow, SetForegroundWindow,
};

use super::clipboard_windows::{
    clipboard_seq, get_clipboard_text, set_clipboard_text, set_clipboard_text_private,
    ClipboardSnapshot,
};
use super::{
    capture_allowed, wait_for_modifiers_released, PasteMethod, RestoreCoordinator, MODIFIER_KEYS,
    VK_CONTROL, VK_SHIFT,
};

/// Tag placed in `dwExtraInfo` of every key event we inject so the keyboard hook can ignore them.
pub const UTTER_INJECT_TAG: usize = 0x5554_5452; // "UTTR"

const VK_V: u16 = 0x56;
const VK_C: u16 = 0x43;
const VK_INSERT: u16 = 0x2D;

/// Serializes insertions and captures AND owns the pending clipboard-restore state, so
/// back-to-back operations always see the user's original clipboard.
static STATE: Mutex<RestoreCoordinator<ClipboardSnapshot>> = Mutex::new(RestoreCoordinator::new());

fn lock_state() -> MutexGuard<'static, RestoreCoordinator<ClipboardSnapshot>> {
    STATE.lock().unwrap_or_else(|e| e.into_inner())
}

fn key_input(vk: u16, up: bool, extended: bool) -> INPUT {
    let mut flags = KEYBD_EVENT_FLAGS(0);
    if up {
        flags |= KEYEVENTF_KEYUP;
    }
    if extended {
        flags |= KEYEVENTF_EXTENDEDKEY;
    }
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VIRTUAL_KEY(vk),
                wScan: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: UTTER_INJECT_TAG,
            },
        },
    }
}

/// Returns the number of events actually injected.
fn send(inputs: &[INPUT]) -> usize {
    // SAFETY: `inputs` is a valid slice of fully initialised INPUT structs.
    unsafe { SendInput(inputs, std::mem::size_of::<INPUT>() as i32) as usize }
}

fn send_all(inputs: &[INPUT]) -> anyhow::Result<()> {
    let sent = send(inputs);
    if sent != inputs.len() {
        anyhow::bail!("SendInput injected {sent} of {} events", inputs.len());
    }
    Ok(())
}

/// Real physical/logical key state via GetAsyncKeyState.
pub fn is_key_down(vk: u16) -> bool {
    // SAFETY: no preconditions.
    (unsafe { GetAsyncKeyState(vk as i32) } as u16) & 0x8000 != 0
}

fn release_all_modifiers() -> anyhow::Result<()> {
    let ups: Vec<INPUT> = MODIFIER_KEYS
        .iter()
        .map(|&vk| key_input(vk, true, false))
        .collect();
    send_all(&ups)
}

fn chord(modifiers: &[u16], key: u16, extended: bool) -> anyhow::Result<()> {
    let mut seq: Vec<INPUT> = modifiers
        .iter()
        .map(|&m| key_input(m, false, false))
        .collect();
    seq.push(key_input(key, false, extended));
    seq.push(key_input(key, true, extended));
    seq.extend(modifiers.iter().rev().map(|&m| key_input(m, true, false)));
    send_all(&seq)
}

/// Inject the paste chord for `method`, after explicit key-ups for every modifier.
pub fn send_paste(method: PasteMethod) -> anyhow::Result<()> {
    release_all_modifiers()?;
    match method {
        PasteMethod::CtrlV => chord(&[VK_CONTROL], VK_V, false),
        PasteMethod::CtrlShiftV => chord(&[VK_CONTROL, VK_SHIFT], VK_V, false),
        PasteMethod::ShiftInsert => chord(&[VK_SHIFT], VK_INSERT, true),
    }
}

fn send_copy() -> anyhow::Result<()> {
    release_all_modifiers()?;
    chord(&[VK_CONTROL], VK_C, false)
}

/// Bring `target` to the foreground; true only if it is the foreground window afterwards.
fn focus(target: isize) -> bool {
    // SAFETY: plain Win32 calls with a window handle value; invalid handles just fail.
    unsafe {
        let hwnd = HWND(target as *mut _);
        if !IsWindow(Some(hwnd)).as_bool() {
            return false;
        }
        let fg = GetForegroundWindow();
        if fg != hwnd {
            // A background process may not steal focus directly; temporarily share input state
            // with the current foreground thread, which lifts the restriction.
            let fg_thread = GetWindowThreadProcessId(fg, None);
            let me = GetCurrentThreadId();
            let attached = fg_thread != 0
                && fg_thread != me
                && AttachThreadInput(me, fg_thread, true).as_bool();
            let _ = SetForegroundWindow(hwnd);
            if attached {
                let _ = AttachThreadInput(me, fg_thread, false);
            }
            std::thread::sleep(Duration::from_millis(80));
        }
        GetForegroundWindow() == hwnd
    }
}

/// Put `text` into the focused control of the target app via clipboard + paste, then restore
/// the user's clipboard if nobody else touched it. If focusing or the paste fails, an error is
/// returned and the text stays on the clipboard (no restore is scheduled).
pub fn insert_text(text: &str, method: PasteMethod, target: Option<isize>) -> anyhow::Result<()> {
    let mut st = lock_state();
    wait_for_modifiers_released(is_key_down, Duration::from_secs(1));
    let (original, _reused) = st.begin(ClipboardSnapshot::take);
    let seq = match set_clipboard_text_private(text) {
        Ok(s) => s,
        Err(e) => {
            // We may have emptied the clipboard before failing: put the user's data back.
            if let Some(o) = &original {
                o.restore();
            }
            return Err(e);
        }
    };
    if let Some(t) = target {
        if !focus(t) {
            anyhow::bail!("target window could not be focused; text left on clipboard");
        }
    }
    std::thread::sleep(Duration::from_millis(30));
    send_paste(method)?;
    if let Some(gen) = st.schedule(original, seq) {
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(350));
            let mut st = lock_state();
            if let Some(snapshot) = st.finish(gen, clipboard_seq()) {
                snapshot.restore();
            }
        });
    }
    Ok(())
}

/// Put `text` on the clipboard and leave it there (Copy last).
pub fn copy_text(text: &str) {
    let mut st = lock_state();
    // The user explicitly asked for this text on the clipboard; drop any pending restore.
    let _ = st.begin(|| None);
    if let Err(e) = set_clipboard_text(text) {
        log::warn!("copy_text failed: {e}");
    }
}

/// Copy the current selection in the foreground app and return it; the clipboard is restored.
/// `method` is the target's paste method: only plain Ctrl+V targets are probed, because Ctrl+C
/// is an interrupt in terminals. Returns None (sending no keys) otherwise.
pub fn capture_selection(method: PasteMethod) -> Option<String> {
    if !capture_allowed(method) {
        return None;
    }
    let mut st = lock_state();
    wait_for_modifiers_released(is_key_down, Duration::from_secs(1));
    let (original, reused) = st.begin(ClipboardSnapshot::take);
    // Without a trustworthy snapshot we must not touch the clipboard at all.
    let original = original?;
    let before = clipboard_seq();
    if send_copy().is_err() {
        if reused {
            original.restore();
        }
        return None;
    }
    let deadline = Instant::now() + Duration::from_millis(400);
    let mut changed = false;
    while Instant::now() < deadline {
        if clipboard_seq() != before {
            changed = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    let text = if changed {
        std::thread::sleep(Duration::from_millis(20));
        get_clipboard_text().filter(|t| !t.is_empty())
    } else {
        None
    };
    // Restore only if the clipboard actually changed, or if it still holds our pending dictation.
    if changed || reused {
        original.restore();
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::insert::clipboard_windows::{clipboard_has_format, set_clipboard_dib_for_test};
    use ::windows::core::{BOOL, PWSTR};
    use ::windows::Win32::Foundation::LPARAM;
    use ::windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, TerminateProcess, PROCESS_NAME_FORMAT,
        PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE,
    };
    use ::windows::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindowTextW, IsWindowVisible};

    fn exe_name(pid: u32) -> Option<String> {
        // SAFETY: buffer sized per API contract.
        unsafe {
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            let mut buf = [0u16; 520];
            let mut len = buf.len() as u32;
            QueryFullProcessImageNameW(
                h,
                PROCESS_NAME_FORMAT(0),
                PWSTR(buf.as_mut_ptr()),
                &mut len,
            )
            .ok()?;
            let s = String::from_utf16_lossy(&buf[..len as usize]);
            Some(s.rsplit('\\').next()?.to_ascii_lowercase())
        }
    }

    struct Found(Vec<(isize, u32)>);

    unsafe extern "system" fn enum_cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let found = &mut *(lparam.0 as *mut Found);
        if IsWindowVisible(hwnd).as_bool() {
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if exe_name(pid).as_deref() == Some("notepad.exe") {
                found.0.push((hwnd.0 as isize, pid));
            }
        }
        BOOL(1)
    }

    fn find_notepads() -> Vec<(isize, u32)> {
        let mut found = Found(Vec::new());
        // SAFETY: callback only dereferences the `Found` we pass for the duration of the call.
        unsafe {
            let _ = EnumWindows(Some(enum_cb), LPARAM(&mut found as *mut Found as isize));
        }
        found.0
    }

    fn window_title(hwnd: isize) -> String {
        let mut buf = [0u16; 512];
        // SAFETY: buffer is valid for its length.
        let n = unsafe { GetWindowTextW(HWND(hwnd as *mut _), &mut buf) };
        String::from_utf16_lossy(&buf[..n.max(0) as usize])
    }

    /// Cleans up even if the test panics: kills our Notepad, deletes the temp file, restores
    /// the developer's clipboard.
    struct Cleanup {
        pid: Option<u32>,
        child: std::process::Child,
        tmp: std::path::PathBuf,
        clipboard: Option<ClipboardSnapshot>,
    }

    impl Drop for Cleanup {
        fn drop(&mut self) {
            if let Some(pid) = self.pid {
                // SAFETY: terminating the Notepad process we launched and verified.
                unsafe {
                    if let Ok(h) = OpenProcess(PROCESS_TERMINATE, false, pid) {
                        let _ = TerminateProcess(h, 0);
                    }
                }
            }
            let _ = self.child.kill();
            std::thread::sleep(Duration::from_millis(200));
            let _ = std::fs::remove_file(&self.tmp);
            if let Some(c) = &self.clipboard {
                c.restore();
            }
        }
    }

    #[test]
    #[ignore = "launches Notepad and drives the real keyboard/clipboard"]
    fn inserts_into_notepad() {
        // Never touch a Notepad the developer already has open (it may hold their work).
        assert!(
            find_notepads().is_empty(),
            "close all Notepad windows before running this test"
        );
        let clipboard = ClipboardSnapshot::take();
        let tmp = std::env::temp_dir().join("utter_insert_test.txt");
        std::fs::write(&tmp, "").expect("temp file");
        let child = std::process::Command::new("notepad.exe")
            .arg(&tmp)
            .spawn()
            .expect("spawn notepad");
        let mut guard = Cleanup {
            pid: None,
            child,
            tmp,
            clipboard,
        };

        let mut windows = Vec::new();
        for _ in 0..50 {
            std::thread::sleep(Duration::from_millis(200));
            windows = find_notepads();
            if !windows.is_empty() {
                break;
            }
        }
        assert_eq!(
            windows.len(),
            1,
            "expected exactly one Notepad window, got {windows:?}"
        );
        let (hwnd, pid) = windows[0];
        guard.pid = Some(pid);
        std::thread::sleep(Duration::from_millis(800));

        let name = "utter_insert_test";
        assert!(focus(hwnd), "could not focus test Notepad");
        assert!(
            window_title(hwnd).contains(name),
            "window is not our temp document: {:?}",
            window_title(hwnd)
        );
        set_clipboard_dib_for_test().expect("set dib");
        let text = "Utter insert test \u{2713}";
        insert_text(text, PasteMethod::CtrlV, Some(hwnd)).expect("insert");
        std::thread::sleep(Duration::from_millis(600));
        let dib_restored = clipboard_has_format(8);

        // select all, capture (only if still our document, still focused)
        let ours = focus(hwnd) && window_title(hwnd).contains(name);
        let captured = if ours {
            chord(&[VK_CONTROL], 0x41, false).expect("select all");
            std::thread::sleep(Duration::from_millis(100));
            capture_selection(PasteMethod::CtrlV)
        } else {
            None
        };

        assert!(ours, "lost focus / wrong document before capture");
        assert!(dib_restored, "CF_DIB should be restored after paste");
        assert_eq!(captured.as_deref(), Some(text));
    }
}
