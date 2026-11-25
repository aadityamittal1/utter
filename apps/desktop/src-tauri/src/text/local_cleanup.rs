//! Local (offline) cleanup of dictated text: fillers, spoken punctuation,
//! line breaks, capitalization and a terminal period.

use once_cell::sync::Lazy;
use regex::{Captures, Regex};

#[allow(clippy::unwrap_used)] // static, known-valid pattern
static FILLERS: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\s*\b(?:um+|uh+|er+m?|ah+|hmm+|mm+)\b,?").unwrap());
#[allow(clippy::unwrap_used)]
static SPACES: Lazy<Regex> = Lazy::new(|| Regex::new(r"[ \t\r\f]+").unwrap());
#[allow(clippy::unwrap_used)]
static PARAGRAPH: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\s*\bnew paragraph\b\s*").unwrap());
#[allow(clippy::unwrap_used)]
static NEWLINE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\s*\bnew line\b\s*").unwrap());
#[allow(clippy::unwrap_used)]
static PUNCT_WORDS: Lazy<Vec<(Regex, &'static str)>> = Lazy::new(|| {
    [
        (r"(?i)\s*\bquestion mark\b", "?"),
        (r"(?i)\s*\bexclamation (?:point|mark)\b", "!"),
        (r"(?i)\s*\bfull stop\b", "."),
        (r"(?i)\s*\bperiod\b", "."),
        (r"(?i)\s*\bsemicolon\b", ";"),
        (r"(?i)\s*\bcolon\b", ":"),
        (r"(?i)\s*\bcomma\b", ","),
    ]
    .into_iter()
    .map(|(p, r)| (Regex::new(p).unwrap(), r))
    .collect()
});
#[allow(clippy::unwrap_used)]
static SPACE_AROUND_NL: Lazy<Regex> = Lazy::new(|| Regex::new(r" *\n[ \n]*").unwrap());
#[allow(clippy::unwrap_used)]
static SPACE_BEFORE_PUNCT: Lazy<Regex> = Lazy::new(|| Regex::new(r" +([,.!?;:])").unwrap());
#[allow(clippy::unwrap_used)]
static CAP_START: Lazy<Regex> = Lazy::new(|| Regex::new(r"(^|[.!?]\s+|\n)(\p{Ll})").unwrap());
#[allow(clippy::unwrap_used)]
static LONE_I: Lazy<Regex> = Lazy::new(|| Regex::new(r"\bi\b(\.[a-z])?").unwrap());

/// Clean raw dictated text without any network access.
pub fn local_cleanup(raw: &str) -> String {
    let mut t = SPACES.replace_all(raw, " ").trim().to_string();
    if t.is_empty() {
        return String::new();
    }
    t = FILLERS.replace_all(&t, "").into_owned();
    t = PARAGRAPH.replace_all(&t, "\n\n").into_owned();
    t = NEWLINE.replace_all(&t, "\n").into_owned();
    for (re, rep) in PUNCT_WORDS.iter() {
        t = re.replace_all(&t, *rep).into_owned();
    }
    t = SPACES.replace_all(&t, " ").into_owned();
    t = SPACE_BEFORE_PUNCT.replace_all(&t, "$1").into_owned();
    // One newline stays a newline; two or more become a paragraph break.
    t = SPACE_AROUND_NL
        .replace_all(&t, |c: &Captures| {
            if c[0].matches('\n').count() >= 2 {
                "\n\n"
            } else {
                "\n"
            }
        })
        .into_owned();
    // A leading spoken-punctuation word must not leave orphan punctuation.
    let t = t
        .trim_start_matches(|c: char| matches!(c, ' ' | '\n' | ',' | '.' | ';' | ':' | '!' | '?'))
        .trim_end_matches(|c: char| c == ' ' || c == '\n')
        .to_string();
    if t.is_empty() {
        return String::new();
    }
    let t = LONE_I
        .replace_all(&t, |c: &Captures| {
            if c.get(1).is_some() {
                c[0].to_string()
            } else {
                "I".to_string()
            }
        })
        .into_owned();
    let mut t = CAP_START
        .replace_all(&t, |c: &Captures| {
            format!("{}{}", &c[1], c[2].to_uppercase())
        })
        .into_owned();
    if t.ends_with(',') {
        t.pop();
        t.push('.');
    } else if let Some(last) = t.chars().last() {
        if last.is_alphanumeric() || matches!(last, ')' | '"' | '\'' | ']') {
            t.push('.');
        }
    }
    t
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn removes_fillers_and_capitalizes() {
        assert_eq!(
            local_cleanup("um so i think uh we should go"),
            "So I think we should go."
        );
    }

    #[test]
    fn spoken_punctuation() {
        assert_eq!(
            local_cleanup("hello comma how are you question mark"),
            "Hello, how are you?"
        );
        assert_eq!(local_cleanup("  wait   exclamation point  "), "Wait!");
    }

    #[test]
    fn line_breaks() {
        assert_eq!(
            local_cleanup("first line new line second line period"),
            "First line\nSecond line."
        );
        assert_eq!(local_cleanup("intro new paragraph body"), "Intro\n\nBody.");
    }

    #[test]
    fn empty_and_blank() {
        assert_eq!(local_cleanup(""), "");
        assert_eq!(local_cleanup("   "), "");
        assert_eq!(local_cleanup("um uh"), "");
    }

    #[test]
    fn all_fillers_removed_but_like_and_you_know_kept() {
        assert_eq!(
            local_cleanup("Umm uhh erm hmm mm ah er so, uh, it was like you know fine"),
            "So, it was like you know fine."
        );
    }

    #[test]
    fn filler_words_inside_words_survive() {
        assert_eq!(
            local_cleanup("the umbrella is here"),
            "The umbrella is here."
        );
    }

    #[test]
    fn does_not_double_terminal_punctuation() {
        assert_eq!(local_cleanup("is this ok?"), "Is this ok?");
    }

    #[test]
    fn leading_punctuation_word_leaves_no_orphan() {
        assert_eq!(local_cleanup("comma hello"), "Hello.");
        assert_eq!(local_cleanup("period"), "");
    }

    #[test]
    fn non_ascii_is_safe() {
        assert_eq!(local_cleanup("um café is nice"), "Café is nice.");
        assert_eq!(local_cleanup("great 😀"), "Great 😀");
        assert_eq!(local_cleanup("été comma ça va"), "Été, ça va.");
    }

    #[test]
    fn contractions_with_i() {
        assert_eq!(local_cleanup("i'm sure i'll go"), "I'm sure I'll go.");
    }
}
