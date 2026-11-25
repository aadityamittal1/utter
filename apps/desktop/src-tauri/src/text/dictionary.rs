//! Personal dictionary: spoken-form replacement, Whisper prompt, auto-learning.

use std::collections::{HashMap, HashSet};

use regex::RegexBuilder;

use super::types::DictEntry;

const PROMPT_MAX_CHARS: usize = 600;
const LEARN_MAX: usize = 5;

fn is_word(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// Replace each entry's `heard_as` (case-insensitive, whole word) with `word`.
/// Entries without `heard_as` are ignored here (they only feed the Whisper prompt).
pub fn apply_replacements(text: &str, entries: &[DictEntry]) -> String {
    let mut map: HashMap<String, &str> = HashMap::new();
    let mut heard: Vec<String> = Vec::new();
    for e in entries {
        let Some(h) = e
            .heard_as
            .as_deref()
            .map(str::trim)
            .filter(|h| !h.is_empty())
        else {
            continue;
        };
        if e.word.is_empty() {
            continue;
        }
        // Duplicate heard_as: the first entry wins.
        if let std::collections::hash_map::Entry::Vacant(v) = map.entry(h.to_lowercase()) {
            v.insert(e.word.as_str());
            heard.push(h.to_string());
        }
    }
    if heard.is_empty() {
        return text.to_string();
    }
    // Longest first so "new york city" wins over "new york".
    heard.sort_by_key(|h| std::cmp::Reverse(h.chars().count()));
    let alts: Vec<String> = heard
        .iter()
        .map(|h| {
            let pre = if h.chars().next().is_some_and(is_word) {
                r"\b"
            } else {
                ""
            };
            let post = if h.chars().last().is_some_and(is_word) {
                r"\b"
            } else {
                ""
            };
            format!("{pre}{}{post}", regex::escape(h))
        })
        .collect();
    let Ok(re) = RegexBuilder::new(&alts.join("|"))
        .case_insensitive(true)
        .build()
    else {
        return text.to_string();
    };
    re.replace_all(text, |c: &regex::Captures| {
        map.get(&c[0].to_lowercase())
            .map(|w| (*w).to_string())
            .unwrap_or_else(|| c[0].to_string())
    })
    .into_owned()
}

/// Comma-separated dictionary words for Whisper's initial prompt, newest
/// (highest id) first, capped at 600 characters.
pub fn whisper_prompt(entries: &[DictEntry]) -> String {
    let mut sorted: Vec<&DictEntry> = entries
        .iter()
        .filter(|e| !e.word.trim().is_empty())
        .collect();
    sorted.sort_by_key(|e| std::cmp::Reverse(e.id));
    let mut out = String::new();
    let mut len = 0usize;
    for e in sorted {
        let w = e.word.trim();
        let add = w.chars().count() + if out.is_empty() { 0 } else { 2 };
        if len + add > PROMPT_MAX_CHARS {
            break;
        }
        if !out.is_empty() {
            out.push_str(", ");
        }
        out.push_str(w);
        len += add;
    }
    out
}

fn strip_edges(tok: &str) -> &str {
    tok.trim_matches(|c: char| !c.is_alphanumeric())
}

/// Words the user introduced or changed when editing `before` into `after`
/// (new, or differing in case other than at a sentence start). Length >= 2,
/// de-duplicated, at most 5, in order of appearance.
pub fn learn_candidates(before: &str, after: &str) -> Vec<String> {
    let before_set: HashSet<&str> = before.split_whitespace().map(strip_edges).collect();
    let before_lower: HashSet<String> = before_set.iter().map(|w| w.to_lowercase()).collect();
    let mut seen: HashSet<String> = HashSet::new();
    let mut out = Vec::new();
    for line in after.lines() {
        let mut sentence_start = true; // a newline is a sentence boundary
        for tok in line.split_whitespace() {
            let w = strip_edges(tok);
            let at_start = sentence_start;
            sentence_start = tok.ends_with(['.', '!', '?']);
            if w.chars().count() < 2 || before_set.contains(w) {
                continue;
            }
            if !w.chars().any(|c| c.is_uppercase() || c.is_ascii_digit()) {
                continue; // only proper-noun-like or numeric words are worth learning
            }
            if STOPWORDS.contains(&w.to_lowercase().as_str()) {
                continue;
            }
            if at_start && before_lower.contains(&w.to_lowercase()) {
                continue; // only capitalized because it begins a sentence
            }
            if seen.insert(w.to_string()) {
                out.push(w.to_string());
                if out.len() == LEARN_MAX {
                    return out;
                }
            }
        }
    }
    out
}

const STOPWORDS: &[&str] = &[
    "the", "and", "but", "for", "nor", "yet", "so", "a", "an", "of", "to", "in", "on", "at", "by",
    "is", "are", "was", "were", "be", "been", "it", "its", "this", "that", "these", "those", "he",
    "she", "we", "they", "you", "i", "me", "my", "our", "your", "his", "her", "their", "if",
    "then", "than", "with", "from", "as", "or", "not", "no", "yes", "do", "does", "did", "have",
    "has", "had", "will", "would", "can", "could", "should", "what", "when", "where", "who", "why",
    "how", "which", "there", "here", "also", "just", "well", "ok", "okay", "hi", "hello", "thanks",
    "thank", "please", "sure", "now", "all", "any", "some", "about", "after", "before",
];

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: i64, word: &str, heard: Option<&str>) -> DictEntry {
        DictEntry {
            id,
            word: word.into(),
            heard_as: heard.map(String::from),
            auto: false,
        }
    }

    #[test]
    fn replaces_heard_with_word() {
        let e = [entry(1, "Claude", Some("clawed"))];
        assert_eq!(
            apply_replacements("ask clawed about it", &e),
            "ask Claude about it"
        );
        assert_eq!(
            apply_replacements("ask CLAWED about it", &e),
            "ask Claude about it"
        );
        assert_eq!(apply_replacements("clawedback", &e), "clawedback");
        assert_eq!(apply_replacements("ask clawed.", &e), "ask Claude.");
    }

    #[test]
    fn entries_without_heard_as_and_special_chars() {
        let e = [
            entry(1, "Utter", None),
            entry(2, "C++", Some("c plus plus")),
        ];
        assert_eq!(apply_replacements("i love c plus plus", &e), "i love C++");
        assert_eq!(apply_replacements("x", &[]), "x");
    }

    #[test]
    fn longest_heard_wins_and_no_dollar_expansion() {
        let e = [
            entry(1, "NYC", Some("new york")),
            entry(2, "$HOME", Some("new york city")),
        ];
        assert_eq!(apply_replacements("new york city", &e), "$HOME");
    }

    #[test]
    fn whisper_prompt_newest_first_and_capped() {
        let e = [
            entry(1, "Alpha", None),
            entry(3, "Gamma", None),
            entry(2, "Beta", None),
        ];
        assert_eq!(whisper_prompt(&e), "Gamma, Beta, Alpha");
        let many: Vec<DictEntry> = (0..200).map(|i| entry(i, "abcdefghij", None)).collect();
        assert!(whisper_prompt(&many).chars().count() <= 600);
        assert_eq!(whisper_prompt(&[]), "");
    }

    #[test]
    fn duplicate_heard_as_first_wins() {
        let e = [
            entry(1, "First", Some("dup")),
            entry(2, "Second", Some("DUP")),
        ];
        assert_eq!(apply_replacements("a dup b", &e), "a First b");
    }

    #[test]
    fn non_ascii_replacements_do_not_panic() {
        let e = [
            entry(1, "Café", Some("cafe")),
            entry(2, "Zoë", Some("zoey")),
        ];
        assert_eq!(apply_replacements("un cafe 😀 zoey", &e), "un Café 😀 Zoë");
        assert_eq!(apply_replacements("CAFÉ 😀", &e), "CAFÉ 😀");
    }

    #[test]
    fn learn_filters_lowercase_stopwords_and_newlines() {
        assert!(learn_candidates("a", "really nice").is_empty());
        assert!(learn_candidates("a", "The And").is_empty());
        assert_eq!(learn_candidates("x", "version 2 of v2"), vec!["v2"]);
        // newline is a sentence boundary: "Hello" after a newline only capitalized
        assert!(learn_candidates("ok\nhello there", "ok\nHello there").is_empty());
    }

    #[test]
    fn learns_new_words() {
        assert_eq!(
            learn_candidates("i met jon at acme", "I met Jon at Acme Corp"),
            vec!["Jon", "Acme", "Corp"]
        );
    }

    #[test]
    fn learn_ignores_sentence_start_case_dedups_and_caps() {
        assert!(learn_candidates("hello world", "Hello world").is_empty());
        assert_eq!(learn_candidates("a", "Zed Zed Zed"), vec!["Zed"]);
        assert_eq!(learn_candidates("x", "Aa Bb Cc Dd Ee Ff Gg").len(), 5);
    }
}
