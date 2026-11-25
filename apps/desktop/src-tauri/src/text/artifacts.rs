//! Strip Whisper non-speech artifacts such as `[BLANK_AUDIO]` or `(music)`.

use once_cell::sync::Lazy;
use regex::Regex;

#[allow(clippy::unwrap_used)] // static, known-valid patterns
static BRACKETED: Lazy<Regex> = Lazy::new(|| Regex::new(r"\[[^\]]*\]").unwrap());
#[allow(clippy::unwrap_used)]
static SOUND_PAREN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)[(*][^()*]{0,40}\b(?:music|applause|laughter|laughs|laughing|silence|noise|inaudible|blank|sighs|coughs|coughing|singing|beep|typing|crosstalk|clapping|speaking|foreign)\b[^()*]{0,40}[)*]",
    )
    .unwrap()
});
#[allow(clippy::unwrap_used)]
static SPACES: Lazy<Regex> = Lazy::new(|| Regex::new(r"\s+").unwrap());

/// Remove non-speech markers; returns `""` when nothing speech-like remains.
/// (Energy-based silence detection lives in the pipeline, not here.)
pub fn strip_artifacts(text: &str) -> String {
    let t = BRACKETED.replace_all(text, " ");
    let t = SOUND_PAREN.replace_all(&t, " ");
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
}
