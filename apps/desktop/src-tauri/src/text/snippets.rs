//! Voice snippets: whole-utterance match, placeholder protection for the AI.

use regex::{Captures, RegexBuilder};

use super::types::Snippet;

fn normalize(s: &str) -> String {
    s.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_matches(|c: char| !c.is_alphanumeric())
        .to_lowercase()
}

/// If the whole utterance (ignoring case and surrounding punctuation) equals a
/// snippet trigger, return that snippet.
pub fn match_whole<'a>(text: &str, s: &'a [Snippet]) -> Option<&'a Snippet> {
    let t = normalize(text);
    if t.is_empty() {
        return None;
    }
    s.iter().find(|sn| normalize(&sn.trigger) == t)
}

/// Replace trigger phrases inside `text` with `⟦S1⟧`, `⟦S2⟧`… (numbered in order
/// of appearance; longest trigger wins). Returns the new text and
/// `(placeholder, expansion)` pairs.
pub fn protect(text: &str, s: &[Snippet]) -> (String, Vec<(String, String)>) {
    let mut trig: Vec<(String, &Snippet)> = s
        .iter()
        .map(|sn| (normalize(&sn.trigger), sn))
        .filter(|(n, _)| !n.is_empty())
        .collect();
    if trig.is_empty() {
        return (text.to_string(), Vec::new());
    }
    trig.sort_by_key(|(n, _)| std::cmp::Reverse(n.chars().count()));
    let alts: Vec<String> = trig
        .iter()
        .map(|(n, _)| {
            let words: Vec<String> = n.split(' ').map(regex::escape).collect();
            format!(r"\b{}\b", words.join(r"\s+"))
        })
        .collect();
    let Ok(re) = RegexBuilder::new(&alts.join("|"))
        .case_insensitive(true)
        .build()
    else {
        return (text.to_string(), Vec::new());
    };
    let mut map: Vec<(String, String)> = Vec::new();
    let out = re
        .replace_all(text, |c: &Captures| {
            let key = normalize(&c[0]);
            match trig.iter().find(|(n, _)| *n == key) {
                Some((_, sn)) => {
                    let ph = format!("⟦S{}⟧", map.len() + 1);
                    map.push((ph.clone(), sn.expansion.clone()));
                    ph
                }
                None => c[0].to_string(),
            }
        })
        .into_owned();
    (out, map)
}

/// Substitute each placeholder with its expansion.
pub fn restore(text: &str, map: &[(String, String)]) -> String {
    let mut out = text.to_string();
    for (ph, exp) in map {
        out = out.replace(ph.as_str(), exp);
    }
    out
}

/// True when every placeholder appears exactly once in `text`.
pub fn placeholders_intact(text: &str, map: &[(String, String)]) -> bool {
    map.iter()
        .all(|(ph, _)| text.matches(ph.as_str()).count() == 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sn(id: i64, t: &str, e: &str) -> Snippet {
        Snippet {
            id,
            trigger: t.into(),
            expansion: e.into(),
        }
    }

    #[test]
    fn match_whole_exact_only() {
        let s = [sn(1, "my linkedin", "https://linkedin.com/in/x")];
        assert!(match_whole("My LinkedIn.", &s).is_some());
        assert!(match_whole("check my linkedin", &s).is_none());
        assert!(match_whole("", &s).is_none());
    }

    #[test]
    fn protect_restore_roundtrip() {
        let s = [
            sn(1, "my linkedin", "A"),
            sn(2, "my email", "B"),
            sn(3, "my linkedin profile", "C"),
        ];
        let (t, map) = protect("here is my linkedin and my email", &s);
        assert_eq!(t, "here is ⟦S1⟧ and ⟦S2⟧");
        assert_eq!(
            map,
            vec![
                ("⟦S1⟧".to_string(), "A".to_string()),
                ("⟦S2⟧".to_string(), "B".to_string())
            ]
        );
        assert_eq!(restore(&t, &map), "here is A and B");
        assert!(placeholders_intact(&t, &map));
        assert!(!placeholders_intact("here is ⟦S1⟧", &map));
    }

    #[test]
    fn longest_trigger_wins() {
        let s = [sn(1, "my linkedin", "A"), sn(3, "my linkedin profile", "C")];
        let (t, map) = protect("see my linkedin profile.", &s);
        assert_eq!(t, "see ⟦S1⟧.");
        assert_eq!(map[0].1, "C");
    }

    #[test]
    fn no_match_and_expansion_with_dollar() {
        let s = [sn(1, "price", "$1 \\n")];
        let (t, map) = protect("nothing here", &s);
        assert_eq!(t, "nothing here");
        assert!(map.is_empty());
        let (t, map) = protect("the price", &s);
        assert_eq!(restore(&t, &map), "the $1 \\n");
    }
}
