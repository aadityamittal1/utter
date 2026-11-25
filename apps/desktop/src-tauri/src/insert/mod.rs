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
/// Only plain Ctrl+V targets get a synthetic Ctrl+C: in terminals / PuTTY Ctrl+C is an interrupt.
pub fn capture_allowed(method: PasteMethod) -> bool {
    method == PasteMethod::CtrlV
}

struct Pending<S> {
    original: Option<S>,
    seq: u32,
    gen: u64,
}

/// Tracks the user's ORIGINAL clipboard while a delayed restore is pending, so back-to-back
/// operations never snapshot our own dictated text as if it were the user's clipboard.
pub struct RestoreCoordinator<S> {
    pending: Option<Pending<S>>,
    next_gen: u64,
}

impl<S> RestoreCoordinator<S> {
    pub const fn new() -> Self {
        Self {
            pending: None,
            next_gen: 0,
        }
    }

    pub fn has_pending(&self) -> bool {
        self.pending.is_some()
    }

    /// Start a new operation. If a restore is pending, reuse (and take over) its original and
    /// supersede it; otherwise call `take` to snapshot the live clipboard.
    /// Returns `(original, reused_pending)`.
    pub fn begin(&mut self, take: impl FnOnce() -> Option<S>) -> (Option<S>, bool) {
        match self.pending.take() {
            Some(p) => (p.original, true),
            None => (take(), false),
        }
    }

    /// Register a delayed restore of `original`. Returns its generation, or None if there is
    /// nothing to restore.
    pub fn schedule(&mut self, original: Option<S>, seq_after_set: u32) -> Option<u64> {
        let original = original?;
        self.next_gen += 1;
        let gen = self.next_gen;
        self.pending = Some(Pending {
            original: Some(original),
            seq: seq_after_set,
            gen,
        });
        Some(gen)
    }

    /// Called when the delay elapses. Returns the snapshot to restore only if this is still the
    /// latest pending restore and the clipboard is still ours.
    pub fn finish(&mut self, gen: u64, seq_now: u32) -> Option<S> {
        if self.pending.as_ref().map(|p| p.gen) != Some(gen) {
            return None;
        }
        let p = self.pending.take()?;
        if should_restore(p.seq, seq_now) {
            p.original
        } else {
            None
        }
    }
}

impl<S> Default for RestoreCoordinator<S> {
    fn default() -> Self {
        Self::new()
    }
}
/// Modifiers that are currently down and so need a synthetic key-up.
pub fn modifiers_to_release(is_down: impl Fn(u16) -> bool) -> Vec<u16> {
    MODIFIER_KEYS
        .iter()
        .copied()
        .filter(|&vk| is_down(vk))
        .collect()
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
    fn releases_only_modifiers_that_are_down() {
        assert_eq!(modifiers_to_release(|_| false), Vec::<u16>::new());
        assert_eq!(
            modifiers_to_release(|vk| vk == VK_SHIFT || vk == VK_LWIN),
            vec![VK_SHIFT, VK_LWIN]
        );
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

    #[test]
    fn capture_only_for_ctrl_v_targets() {
        assert!(capture_allowed(PasteMethod::CtrlV));
        assert!(!capture_allowed(PasteMethod::CtrlShiftV));
        assert!(!capture_allowed(PasteMethod::ShiftInsert));
    }

    #[test]
    fn coordinator_fresh_begin_snapshots() {
        let mut c: RestoreCoordinator<&str> = RestoreCoordinator::new();
        let (o, reused) = c.begin(|| Some("orig"));
        assert_eq!((o, reused), (Some("orig"), false));
    }

    #[test]
    fn coordinator_reuses_pending_original_and_supersedes() {
        let mut c: RestoreCoordinator<&str> = RestoreCoordinator::new();
        let (o, _) = c.begin(|| Some("orig"));
        let g1 = c.schedule(o, 10).unwrap();
        // second op within the window must NOT call take (clipboard holds dictation #1)
        let (o2, reused) = c.begin(|| panic!("must not re-snapshot"));
        assert!(reused);
        assert_eq!(o2, Some("orig"));
        let g2 = c.schedule(o2, 20).unwrap();
        assert_ne!(g1, g2);
        // stale restore does nothing, even if seq matches
        assert_eq!(c.finish(g1, 20), None);
        assert_eq!(c.finish(g2, 20), Some("orig"));
        assert!(!c.has_pending());
    }

    #[test]
    fn coordinator_skips_restore_when_user_copied() {
        let mut c: RestoreCoordinator<&str> = RestoreCoordinator::new();
        let g = c.schedule(Some("orig"), 5).unwrap();
        assert_eq!(c.finish(g, 6), None);
        assert!(!c.has_pending());
    }

    #[test]
    fn coordinator_nothing_to_restore() {
        let mut c: RestoreCoordinator<&str> = RestoreCoordinator::new();
        assert_eq!(c.schedule(None, 1), None);
        assert!(!c.has_pending());
    }

    #[test]
    fn coordinator_capture_takes_over_pending() {
        let mut c: RestoreCoordinator<&str> = RestoreCoordinator::new();
        let g = c.schedule(Some("orig"), 5).unwrap();
        let (o, reused) = c.begin(|| None);
        assert_eq!((o, reused), (Some("orig"), true));
        assert_eq!(c.finish(g, 5), None); // superseded; capture restores itself
    }
}
