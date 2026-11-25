//! Keystroke injection (SendInput), paste, and selection capture.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use ::windows::Win32::Foundation::HWND;
use ::windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
use ::windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS,
    KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, VIRTUAL_KEY,
};
use ::windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetWindowThreadProcessId, SetForegroundWindow,
};

use super::clipboard_windows::{
    clipboard_seq, get_clipboard_text, set_clipboard_text, ClipboardSnapshot,
};
use super::{
    should_restore, wait_for_modifiers_released, PasteMethod, MODIFIER_KEYS, VK_CONTROL, VK_SHIFT,
};

/// Tag placed in `dwExtraInfo` of every key event we inject so the keyboard hook can ignore them.
pub const UTTER_INJECT_TAG: usize = 0x5554_5452; // "UTTR"

const VK_V: u16 = 0x56;
const VK_C: u16 = 0x43;
const VK_INSERT: u16 = 0x2D;

/// Serializes insertions and captures so clipboard save/restore never interleave.
static INSERT_LOCK: Mutex<()> = Mutex::new(());

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

fn send(inputs: &[INPUT]) {
    // SAFETY: `inputs` is a valid slice of fully initialised INPUT structs.
    unsafe {
        SendInput(inputs, std::mem::size_of::<INPUT>() as i32);
    }
}

/// Real physical/logical key state via GetAsyncKeyState.
pub fn is_key_down(vk: u16) -> bool {
    // SAFETY: no preconditions.
    (unsafe { GetAsyncKeyState(vk as i32) } as u16) & 0x8000 != 0
}

fn release_all_modifiers() {
    let ups: Vec<INPUT> = MODIFIER_KEYS
        .iter()
        .map(|&vk| key_input(vk, true, false))
        .collect();
    send(&ups);
}

fn chord(modifiers: &[u16], key: u16, extended: bool) {
    let mut seq: Vec<INPUT> = modifiers
        .iter()
        .map(|&m| key_input(m, false, false))
        .collect();
    seq.push(key_input(key, false, extended));
    seq.push(key_input(key, true, extended));
    seq.extend(modifiers.iter().rev().map(|&m| key_input(m, true, false)));
    send(&seq);
}

/// Inject the paste chord for `method`, after explicit key-ups for every modifier.
pub fn send_paste(method: PasteMethod) {
    release_all_modifiers();
    match method {
        PasteMethod::CtrlV => chord(&[VK_CONTROL], VK_V, false),
        PasteMethod::CtrlShiftV => chord(&[VK_CONTROL, VK_SHIFT], VK_V, false),
        PasteMethod::ShiftInsert => chord(&[VK_SHIFT], VK_INSERT, true),
    }
}

fn send_copy() {
    release_all_modifiers();
    chord(&[VK_CONTROL], VK_C, false);
}

fn focus(target: isize) {
    // SAFETY: plain Win32 calls with a window handle value; invalid handles just fail.
    unsafe {
        let hwnd = HWND(target as *mut _);
        let fg = GetForegroundWindow();
        if fg == hwnd {
            return;
        }
        // A background process may not steal focus directly; temporarily share input state
        // with the current foreground thread, which lifts the restriction.
        let fg_thread = GetWindowThreadProcessId(fg, None);
        let me = GetCurrentThreadId();
        let attached =
            fg_thread != 0 && fg_thread != me && AttachThreadInput(me, fg_thread, true).as_bool();
        let _ = SetForegroundWindow(hwnd);
        if attached {
            let _ = AttachThreadInput(me, fg_thread, false);
        }
        std::thread::sleep(Duration::from_millis(80));
    }
}
/// Put `text` into the focused control of the target app via clipboard + paste, then restore
/// the user's clipboard if nobody else touched it. If the paste itself fails the text stays on
/// the clipboard.
pub fn insert_text(text: &str, method: PasteMethod, target: Option<isize>) -> anyhow::Result<()> {
    let _lock = INSERT_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    wait_for_modifiers_released(is_key_down, Duration::from_secs(1));
    if let Some(t) = target {
        focus(t);
    }
    let snapshot = ClipboardSnapshot::take();
    let seq = set_clipboard_text(text)?;
    std::thread::sleep(Duration::from_millis(30));
    send_paste(method);
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(350));
        if should_restore(seq, clipboard_seq()) {
            snapshot.restore();
        }
    });
    Ok(())
}

/// Put `text` on the clipboard and leave it there (Copy last).
pub fn copy_text(text: &str) {
    let _lock = INSERT_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    if let Err(e) = set_clipboard_text(text) {
        log::warn!("copy_text failed: {e}");
    }
}

/// Copy the current selection in the foreground app and return it; the clipboard is restored.
pub fn capture_selection() -> Option<String> {
    let _lock = INSERT_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    wait_for_modifiers_released(is_key_down, Duration::from_secs(1));
    let snapshot = ClipboardSnapshot::take();
    let before = clipboard_seq();
    send_copy();
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
    snapshot.restore();
    text
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::insert::clipboard_windows::{clipboard_has_format, set_clipboard_dib_for_test};
    use ::windows::core::{BOOL, PWSTR};
    use ::windows::Win32::Foundation::{LPARAM, WPARAM};
    use ::windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, TerminateProcess, PROCESS_NAME_FORMAT,
        PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE,
    };
    use ::windows::Win32::UI::WindowsAndMessaging::{EnumWindows, IsWindowVisible};

    fn exe_name(pid: u32) -> Option<String> {
        // SAFETY: handle closed implicitly at process end; buffer sized per API contract.
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

    fn find_notepad() -> Option<(isize, u32)> {
        let mut found = Found(Vec::new());
        // SAFETY: callback only dereferences the `Found` we pass for the duration of the call.
        unsafe {
            let _ = EnumWindows(Some(enum_cb), LPARAM(&mut found as *mut Found as isize));
        }
        found.0.into_iter().next()
    }

    #[test]
    #[ignore = "launches Notepad and drives the real keyboard/clipboard"]
    fn inserts_into_notepad() {
        let _ = WPARAM(0);
        // Never touch a Notepad the developer already has open (it may hold their work).
        assert!(
            find_notepad().is_none(),
            "close all Notepad windows before running this test"
        );
        let tmp = std::env::temp_dir().join("utter_insert_test.txt");
        std::fs::write(&tmp, "").expect("temp file");
        let mut child = std::process::Command::new("notepad.exe")
            .arg(&tmp)
            .spawn()
            .expect("spawn notepad");
        let mut hwnd_pid = None;
        for _ in 0..50 {
            std::thread::sleep(Duration::from_millis(200));
            if let Some(found) = find_notepad() {
                hwnd_pid = Some(found);
                break;
            }
        }
        let (hwnd, pid) = hwnd_pid.expect("notepad window");
        std::thread::sleep(Duration::from_millis(800));

        focus(hwnd);
        assert_eq!(
            unsafe { GetForegroundWindow() }.0 as isize,
            hwnd,
            "could not focus test Notepad"
        );
        set_clipboard_dib_for_test().expect("set dib");
        let text = "Utter insert test \u{2713}";
        insert_text(text, PasteMethod::CtrlV, Some(hwnd)).expect("insert");
        std::thread::sleep(Duration::from_millis(600));
        let dib_restored = clipboard_has_format(8);

        // select all, capture (only if still focused on our Notepad)
        focus(hwnd);
        let still_focused = unsafe { GetForegroundWindow() }.0 as isize == hwnd;
        let captured = if still_focused {
            chord(&[VK_CONTROL], 0x41, false);
            std::thread::sleep(Duration::from_millis(100));
            capture_selection()
        } else {
            None
        };

        // close without saving: terminate this notepad process
        // SAFETY: terminating the Notepad process we launched/located.
        unsafe {
            if let Ok(h) = OpenProcess(PROCESS_TERMINATE, false, pid) {
                let _ = TerminateProcess(h, 0);
            }
        }
        let _ = child.kill();
        let _ = std::fs::remove_file(&tmp);

        assert!(dib_restored, "CF_DIB should be restored after paste");
        assert_eq!(captured.as_deref(), Some(text));
    }
}
