//! Paste-method policy: which key chord pastes into which foreground process.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PasteMethod {
    CtrlV,
    CtrlShiftV,
    ShiftInsert,
}

/// `process` is a lowercased exe file name (e.g. `windowsterminal.exe`);
/// matching is case-insensitive regardless.
pub fn paste_method_for(process: &str) -> PasteMethod {
    match process.to_ascii_lowercase().as_str() {
        "windowsterminal.exe"
        | "conhost.exe"
        | "wezterm-gui.exe"
        | "alacritty.exe"
        | "mintty.exe" => PasteMethod::CtrlShiftV,
        "putty.exe" => PasteMethod::ShiftInsert,
        _ => PasteMethod::CtrlV,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminals_use_ctrl_shift_v() {
        for p in [
            "windowsterminal.exe",
            "conhost.exe",
            "wezterm-gui.exe",
            "alacritty.exe",
            "mintty.exe",
        ] {
            assert_eq!(paste_method_for(p), PasteMethod::CtrlShiftV, "{p}");
        }
    }

    #[test]
    fn putty_uses_shift_insert() {
        assert_eq!(paste_method_for("putty.exe"), PasteMethod::ShiftInsert);
    }

    #[test]
    fn everything_else_uses_ctrl_v() {
        for p in [
            "notepad.exe",
            "chrome.exe",
            "code.exe",
            "",
            "windowsterminal",
        ] {
            assert_eq!(paste_method_for(p), PasteMethod::CtrlV, "{p}");
        }
    }

    #[test]
    fn matching_is_case_insensitive() {
        assert_eq!(
            paste_method_for("WindowsTerminal.EXE"),
            PasteMethod::CtrlShiftV
        );
        assert_eq!(paste_method_for("PuTTY.exe"), PasteMethod::ShiftInsert);
    }
}
