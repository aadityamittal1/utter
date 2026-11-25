//! Strip Whisper non-speech artifacts such as `[BLANK_AUDIO]` or `(music)`.

use once_cell::sync::Lazy;
use regex::{Captures, Regex};

#[allow(clippy::unwrap_used)] // static, known-valid patterns
static BRACKETED: Lazy<Regex> = Lazy::new(|| Regex::new(r"\[[^\]]*\]").unwrap());
#[allow(clippy::unwrap_used)]
static PAREN: Lazy<Regex> = Lazy::new(|| Regex::new(r"\(([^()]*)\)").unwrap());
#[allow(clippy::unwrap_used)]
static STARRED: Lazy<Regex> = Lazy::new(|| Regex::new(r"\*([^*\n]*)\*").unwrap());
#[allow(clippy::unwrap_used)]
static SPACES: Lazy<Regex> = Lazy::new(|| Regex::new(r"\s+").unwrap());

/// Words that name a non-speech sound (only unambiguous sound words).
const SOUND_WORDS: &[&str] = &[
    "music",
    "applause",
    "laughter",
    "laughs",
    "laughing",
    "inaudible",
    "silence",
    "noise",
    "sighs",
    "coughs",
    "coughing",
    "singing",
    "beep",
    "crosstalk",
    "clapping",
];
/// Generic descriptors allowed next to a sound word.
const GENERIC_WORDS: &[&str] = &[
    "soft",
    "background",
    "upbeat",
    "light",
    "loud",
    "quiet",
    "gentle",
    "dramatic",
    "distant",
    "slow",
    "sad",
    "happy",
    "audience",
];

/// True when the whole group content is a short sound description:
/// 1-3 words, at least one sound word, all others generic descriptors.
fn is_sound_description(content: &str) -> bool {
    let words: Vec<String> = content
        .split_whitespace()
        .map(|w| {
            w.trim_matches(|c: char| !c.is_alphanumeric())
                .to_lowercase()
        })
        .collect();
    if words.is_empty() || words.len() > 3 || words.iter().any(|w| w.is_empty()) {
        return false;
    }
    words.iter().any(|w| SOUND_WORDS.contains(&w.as_str()))
        && words
            .iter()
            .all(|w| SOUND_WORDS.contains(&w.as_str()) || GENERIC_WORDS.contains(&w.as_str()))
}

/// Remove non-speech markers; returns `""` when nothing speech-like remains.
/// (Energy-based silence detection lives in the pipeline, not here.)
pub fn strip_artifacts(text: &str) -> String {
    let t = BRACKETED.replace_all(text, " ");
    let t = PAREN.replace_all(&t, |c: &Captures| {
        if is_sound_description(&c[1]) {
            " ".to_string()
        } else {
            c[0].to_string()
        }
    });
    let t = STARRED.replace_all(&t, |c: &Captures| {
        // `*applause*` hugs its content; `2 * noise * 3` (spaces) is not a marker.
        let inner = &c[1];
        let hugged =
            !inner.starts_with(char::is_whitespace) && !inner.ends_with(char::is_whitespace);
        if hugged && is_sound_description(inner) {
            " ".to_string()
        } else {
            c[0].to_string()
        }
    });
    let t = t.replace(['♪', '♫'], " ");
    let t = SPACES.replace_all(&t, " ").trim().to_string();
    if t.chars().any(|c| c.is_alphanumeric()) {
        t
    } else {
        String::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blank_audio_is_empty() {
        assert_eq!(strip_artifacts("[BLANK_AUDIO]"), "");
        assert_eq!(strip_artifacts("  [ Silence ] "), "");
    }

    #[test]
    fn strips_markers_keeps_speech() {
        assert_eq!(strip_artifacts("(music) Hello"), "Hello");
        assert_eq!(strip_artifacts("Hello [inaudible] world"), "Hello world");
        assert_eq!(strip_artifacts("♪ Hello ♪"), "Hello");
        assert_eq!(strip_artifacts("*applause* thanks"), "thanks");
    }

    #[test]
    fn real_text_untouched() {
        assert_eq!(strip_artifacts(" Thank you. "), "Thank you.");
        assert_eq!(
            strip_artifacts("call me (maybe) later"),
            "call me (maybe) later"
        );
    }

    #[test]
    fn keeps_real_parentheticals_and_math() {
        for s in [
            "(speaking of which)",
            "(foreign policy)",
            "(noise reduction)",
            "(blank slate)",
            "2 * noise * 3",
            "(music*",
        ] {
            assert_eq!(strip_artifacts(s), s, "{s}");
        }
        assert_eq!(
            strip_artifacts("we talked (foreign policy) today"),
            "we talked (foreign policy) today"
        );
    }

    #[test]
    fn strips_short_sound_descriptions() {
        assert_eq!(strip_artifacts("(music)"), "");
        assert_eq!(strip_artifacts("(upbeat music) Hi"), "Hi");
        assert_eq!(strip_artifacts("*applause*"), "");
        assert_eq!(strip_artifacts("(inaudible)"), "");
        assert_eq!(strip_artifacts("(soft background music) ok"), "ok");
    }
}
