//! Text insertion into the foreground app and selection capture.
//!
//! Pure logic lives here; Win32 specifics are in `clipboard_windows` / `keys_windows`.

pub mod policy;
pub use policy::{paste_method_for, PasteMethod};

use std::time::{Duration, Instant};

#[cfg(target_os = "windows")]
pub mod clipboard_windows;
#[cfg(target_os = "windows")]
pub mod keys_windows;

#[cfg(target_os = "windows")]
pub use clipboard_windows::{clipboard_seq, set_clipboard_text, ClipboardSnapshot};
#[cfg(target_os = "windows")]
pub use keys_windows::{capture_selection, copy_text, insert_text, send_paste};

pub const VK_SHIFT: u16 = 0x10;
pub const VK_CONTROL: u16 = 0x11;
pub const VK_MENU: u16 = 0x12;
pub const VK_LWIN: u16 = 0x5B;
pub const VK_RWIN: u16 = 0x5C;
pub const MODIFIER_KEYS: [u16; 5] = [VK_CONTROL, VK_SHIFT, VK_MENU, VK_LWIN, VK_RWIN];

/// Restore the user's clipboard only if nothing else touched it since we set our text.
pub fn should_restore(seq_after_our_set: u32, seq_now: u32) -> bool {
    seq_after_our_set == seq_now
}

/// Poll (every 10 ms) until no modifier key is physically down. Returns false on timeout.
pub fn wait_for_modifiers_released(is_down: impl Fn(u16) -> bool, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if !MODIFIER_KEYS.iter().any(|&vk| is_down(vk)) {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_restore_only_when_seq_unchanged() {
        assert!(should_restore(5, 5));
        assert!(!should_restore(5, 6));
    }

    #[test]
    fn waits_until_win_released() {
        let start = Instant::now();
        let down = |vk: u16| vk == VK_LWIN && start.elapsed() < Duration::from_millis(50);
        let ok = wait_for_modifiers_released(down, Duration::from_millis(1000));
        assert!(ok);
        assert!(start.elapsed() >= Duration::from_millis(50));
    }

    #[test]
    fn times_out_when_always_down() {
        let start = Instant::now();
        assert!(!wait_for_modifiers_released(
            |vk| vk == VK_CONTROL,
            Duration::from_millis(100)
        ));
        assert!(start.elapsed() >= Duration::from_millis(100));
    }

    #[test]
    fn returns_immediately_when_nothing_down() {
        assert!(wait_for_modifiers_released(
            |_| false,
            Duration::from_millis(100)
        ));
    }
}
