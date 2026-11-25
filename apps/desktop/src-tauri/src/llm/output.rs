//! Post-processing of raw model output: strip wrappers the model sometimes adds.

use once_cell::sync::Lazy;
use regex::Regex;

static PREAMBLE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^here(?:'s|\u{2019}s| is) (?:the|your) [^:\n]{0,40}:\s*").expect("valid regex")
});

static PREAMBLE_START: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)^here(?:'s|\u{2019}s| is) (?:the|your)\b").expect("valid regex"));

/// Trim `raw` and strip a single wrapping code fence, `<output>` tag pair,
/// leading "Here's the ...:" preamble, and a single wrapping pair of quotes.
pub fn extract_output(raw: &str) -> String {
    extract_inner(raw, true)
}

/// Like [`extract_output`], but keeps a leading "Here's the ...:" when the dictated
/// `input` itself starts that way (it is then the user's own words, not a preamble).
pub fn extract_output_for(raw: &str, input: &str) -> String {
    // Dictated speech has no colon, so match the preamble's opening words only.
    let own = PREAMBLE_START.is_match(input.trim_start());
    extract_inner(raw, !own)
}

fn extract_inner(raw: &str, strip_preamble: bool) -> String {
    let mut s = raw.trim().to_string();

    s = strip_fence(&s);
    s = strip_output_tags(&s);
    if strip_preamble {
        s = PREAMBLE.replace(&s, "").trim().to_string();
    }
    // A preamble may precede a fence/tags/quotes, so re-run the wrappers once.
    s = strip_fence(&s);
    s = strip_output_tags(&s);
    s = strip_quotes(&s);
    s.trim().to_string()
}

fn strip_fence(s: &str) -> String {
    let t = s.trim();
    if t.starts_with("```") && t.ends_with("```") && t.len() >= 6 {
        let inner = &t[3..t.len() - 3];
        // Drop an optional language tag on the first line.
        let inner = match inner.split_once('\n') {
            Some((first, rest)) if !first.contains(' ') && first.len() <= 16 => rest,
            _ => inner,
        };
        return inner.trim().to_string();
    }
    t.to_string()
}

fn strip_output_tags(s: &str) -> String {
    let mut t = s.trim();
    if let Some(rest) = t.strip_prefix("<output>") {
        t = rest;
    }
    if let Some(rest) = t.trim_end().strip_suffix("</output>") {
        t = rest;
    }
    t.trim().to_string()
}

fn strip_quotes(s: &str) -> String {
    let t = s.trim();
    let n = t.chars().count();
    if n < 2 {
        return t.to_string();
    }
    let first = t.chars().next().unwrap_or(' ');
    let last = t.chars().next_back().unwrap_or(' ');
    let inner: String = t.chars().skip(1).take(n - 2).collect();
    let wrapped = match (first, last) {
        ('"', '"') => !inner.contains('"'),
        ('\u{201C}', '\u{201D}') => !inner.contains('\u{201C}') && !inner.contains('\u{201D}'),
        _ => false,
    };
    if wrapped {
        inner.trim().to_string()
    } else {
        t.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_preamble() {
        assert_eq!(
            extract_output("Here's the cleaned text: Hi there."),
            "Hi there."
        );
        assert_eq!(
            extract_output("Here is your rewritten message:\n\nHi there."),
            "Hi there."
        );
        assert_eq!(extract_output("HERE\u{2019}S THE TEXT: Hi."), "Hi.");
    }

    #[test]
    fn strips_wrapping_quotes_only_when_single_pair() {
        assert_eq!(extract_output("\"Hi.\""), "Hi.");
        assert_eq!(extract_output("\u{201C}Hi.\u{201D}"), "Hi.");
        let two = "\"Hi,\" she said, \"bye.\"";
        assert_eq!(extract_output(two), two);
    }

    #[test]
    fn strips_fences_and_tags() {
        assert_eq!(extract_output("```\nHi there.\n```"), "Hi there.");
        assert_eq!(extract_output("```text\nHi there.\n```"), "Hi there.");
        assert_eq!(extract_output("<output>Hi there.</output>"), "Hi there.");
        assert_eq!(
            extract_output("<output>\nHi there.\n</output>"),
            "Hi there."
        );
        assert_eq!(extract_output("Here's the text: \"Hi.\""), "Hi.");
    }

    #[test]
    fn leaves_clean_text_unchanged() {
        assert_eq!(extract_output("Hi there."), "Hi there.");
        assert_eq!(extract_output("  Hi there.\n"), "Hi there.");
        assert_eq!(extract_output(""), "");
        assert_eq!(extract_output("\""), "\"");
    }

    #[test]
    fn extract_output_for_keeps_users_own_lead_in() {
        assert_eq!(
            extract_output_for(
                "Here's the plan: we ship Friday.",
                "here's the plan we ship friday"
            ),
            "Here's the plan: we ship Friday."
        );
        assert_eq!(
            extract_output_for("Here's the cleaned text: Hi.", "we ship friday"),
            "Hi."
        );
        assert_eq!(
            extract_output_for("Here's the cleaned text: We ship Friday.", "we ship friday"),
            "We ship Friday."
        );
    }

    #[test]
    fn keeps_placeholders() {
        assert_eq!(extract_output("Send ⟦S1⟧ to Bob."), "Send ⟦S1⟧ to Bob.");
    }
}
