//! Local style transforms (no AI).

use super::types::StyleKind;

/// Apply a style locally. Casual drops the final period, very casual also
/// lowercases; Formal and Excited are left unchanged (Excited needs the AI).
pub fn apply_style_local(text: &str, style: StyleKind) -> String {
    match style {
        StyleKind::Formal | StyleKind::Excited => text.to_string(),
        StyleKind::Casual => strip_final_period(text),
        StyleKind::VeryCasual => strip_final_period(text).to_lowercase(),
    }
}

fn strip_final_period(text: &str) -> String {
    let t = text.trim_end();
    if t.ends_with('.') && !t.ends_with("..") {
        t[..t.len() - 1].to_string()
    } else {
        t.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn casual_drops_final_period() {
        assert_eq!(
            apply_style_local("Hello there. See you soon.", StyleKind::Casual),
            "Hello there. See you soon"
        );
    }

    #[test]
    fn very_casual_lowercases() {
        assert_eq!(
            apply_style_local("Hello there. See you soon.", StyleKind::VeryCasual),
            "hello there. see you soon"
        );
    }

    #[test]
    fn formal_and_excited_unchanged() {
        let s = "Hello there. See you soon.";
        assert_eq!(apply_style_local(s, StyleKind::Formal), s);
        assert_eq!(apply_style_local(s, StyleKind::Excited), s);
    }

    #[test]
    fn non_ascii_is_safe() {
        assert_eq!(apply_style_local("Café 😀.", StyleKind::Casual), "Café 😀");
        assert_eq!(
            apply_style_local("CAFÉ 😀.", StyleKind::VeryCasual),
            "café 😀"
        );
    }

    #[test]
    fn ellipsis_and_question_kept() {
        assert_eq!(apply_style_local("Hmm...", StyleKind::Casual), "Hmm...");
        assert_eq!(apply_style_local("Really?", StyleKind::Casual), "Really?");
    }
}
