//! Which window should text go to? Pure decisions (no Win32), so they are unit-testable.
//!
//! Utter's own windows (tray menu, pill, hub) can be in the foreground when an action starts.
//! Text must never be pasted into those by accident; it goes to the last external window.

use super::classify::AppInfo;

/// Is `app` a real external window (not ours, not shell chrome like the taskbar or desktop)?
pub fn is_external(app: &AppInfo, own_pid: u32) -> bool {
    if app.hwnd == 0 || (app.pid != 0 && app.pid == own_pid) {
        return false;
    }
    // Clicking the tray makes the taskbar (explorer.exe, no title) or desktop the foreground.
    let shell_chrome = app.process == "explorer.exe"
        && (app.title.trim().is_empty() || app.title == "Program Manager");
    !shell_chrome
}

/// The window to re-focus at the end of a dictation, decided when the hotkey was pressed.
/// Our own windows other than the hub are not a target: the text goes to whatever is in the
/// foreground when the dictation finishes (the pill and tray menu are gone by then).
pub fn press_target(app: Option<&AppInfo>, own_pid: u32, hub_hwnd: Option<isize>) -> Option<isize> {
    let a = app?;
    if a.hwnd == 0 {
        return None;
    }
    let own = a.pid != 0 && a.pid == own_pid;
    if own && hub_hwnd != Some(a.hwnd) {
        return None;
    }
    Some(a.hwnd)
}

/// Where "Paste last" should put the text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PasteLastPlan {
    /// Paste into the current foreground window.
    Foreground,
    /// Re-focus this earlier external window first.
    Refocus(isize),
    /// Nowhere sensible: copy to the clipboard and tell the user to paste.
    ClipboardOnly,
}

pub fn paste_last_plan(
    fg: Option<&AppInfo>,
    own_pid: u32,
    hub_hwnd: Option<isize>,
    last_external: Option<isize>,
) -> PasteLastPlan {
    if let Some(a) = fg {
        if is_external(a, own_pid) || (a.hwnd != 0 && hub_hwnd == Some(a.hwnd)) {
            return PasteLastPlan::Foreground;
        }
    }
    match last_external {
        Some(h) if h != 0 => PasteLastPlan::Refocus(h),
        _ => PasteLastPlan::ClipboardOnly,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const OWN: u32 = 100;

    fn win(process: &str, title: &str, hwnd: isize, pid: u32) -> AppInfo {
        AppInfo {
            process: process.into(),
            title: title.into(),
            hwnd,
            pid,
        }
    }

    #[test]
    fn external_window_is_the_press_target() {
        let a = win("notepad.exe", "x", 5, 7);
        assert_eq!(press_target(Some(&a), OWN, Some(9)), Some(5));
    }

    #[test]
    fn own_non_hub_window_records_no_target() {
        let tray = win("utter.exe", "", 6, OWN);
        assert_eq!(press_target(Some(&tray), OWN, Some(9)), None);
    }

    #[test]
    fn hub_is_a_valid_target() {
        let hub = win("utter.exe", "Utter", 9, OWN);
        assert_eq!(press_target(Some(&hub), OWN, Some(9)), Some(9));
    }

    #[test]
    fn no_foreground_means_no_target() {
        assert_eq!(press_target(None, OWN, None), None);
    }

    #[test]
    fn taskbar_is_not_external() {
        assert!(!is_external(&win("explorer.exe", "", 3, 4), OWN));
        assert!(!is_external(
            &win("explorer.exe", "Program Manager", 3, 4),
            OWN
        ));
        assert!(is_external(&win("explorer.exe", "Downloads", 3, 4), OWN));
        assert!(!is_external(&win("utter.exe", "x", 3, OWN), OWN));
    }

    #[test]
    fn paste_last_prefers_external_foreground() {
        let a = win("notepad.exe", "x", 5, 7);
        assert_eq!(
            paste_last_plan(Some(&a), OWN, Some(9), Some(2)),
            PasteLastPlan::Foreground
        );
    }

    #[test]
    fn paste_last_from_tray_refocuses_last_external() {
        let tray = win("utter.exe", "", 6, OWN);
        assert_eq!(
            paste_last_plan(Some(&tray), OWN, Some(9), Some(2)),
            PasteLastPlan::Refocus(2)
        );
        let taskbar = win("explorer.exe", "", 8, 4);
        assert_eq!(
            paste_last_plan(Some(&taskbar), OWN, Some(9), Some(2)),
            PasteLastPlan::Refocus(2)
        );
    }

    #[test]
    fn paste_last_without_any_target_copies_only() {
        let tray = win("utter.exe", "", 6, OWN);
        assert_eq!(
            paste_last_plan(Some(&tray), OWN, None, None),
            PasteLastPlan::ClipboardOnly
        );
        assert_eq!(
            paste_last_plan(None, OWN, None, None),
            PasteLastPlan::ClipboardOnly
        );
    }

    #[test]
    fn paste_last_into_the_hub_stays_in_the_hub() {
        let hub = win("utter.exe", "Utter", 9, OWN);
        assert_eq!(
            paste_last_plan(Some(&hub), OWN, Some(9), Some(2)),
            PasteLastPlan::Foreground
        );
    }
}
