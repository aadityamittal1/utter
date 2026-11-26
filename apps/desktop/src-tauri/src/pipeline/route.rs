//! Pure routing and output-acceptance rules for the dictation pipeline.

use crate::text::dictionary::apply_replacements;
use crate::text::local_cleanup::local_cleanup;
use crate::text::snippets::{match_whole, placeholders_intact, restore};
use crate::text::style::apply_style_local;
use crate::text::types::{Category, CleanupLevel, DictEntry, Snippet, StyleKind};

/// What the user asked for with the hotkey.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Dictate,
    DictateEnhance,
    Command,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AiKind {
    Cleanup,
    Enhance,
    Command,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Route {
    /// Nothing to insert (silence, empty transcript, or a command without a key).
    Nothing,
    /// The whole utterance is a snippet trigger: insert its expansion, no AI.
    SnippetOnly(String),
    /// Local cleanup only.
    Local,
    Claude(AiKind),
}

/// Decide what to do with a transcript. `text` is the Whisper text (artifacts not yet stripped
/// is fine: this strips them again defensively).
#[allow(clippy::too_many_arguments)]
pub fn plan_route(
    text: &str,
    silent: bool,
    mode: Mode,
    level: CleanupLevel,
    has_key: bool,
    category: Category,
    auto_enhance: &[Category],
    snippets: &[Snippet],
) -> Route {
    let text = crate::text::artifacts::strip_artifacts(text);
    if silent || text.trim().is_empty() {
        return Route::Nothing;
    }
    if mode == Mode::Command {
        return if has_key {
            Route::Claude(AiKind::Command)
        } else {
            Route::Nothing
        };
    }
    if let Some(s) = match_whole(&text, snippets) {
        return Route::SnippetOnly(s.expansion.clone());
    }
    if mode == Mode::DictateEnhance || auto_enhance.contains(&category) {
        return if has_key {
            Route::Claude(AiKind::Enhance)
        } else {
            Route::Local
        };
    }
    if level == CleanupLevel::Off || !has_key {
        return Route::Local;
    }
    Route::Claude(AiKind::Cleanup)
}

const QUESTION_WORDS: &[&str] = &[
    "what", "why", "how", "when", "where", "who", "which", "can", "could", "would", "should", "is",
    "are", "do", "does", "did", "will",
];

/// True when the dictated text is phrased as a question.
fn looks_like_question(input: &str) -> bool {
    let t = input.trim();
    if t.ends_with('?') {
        return true;
    }
    let first: String = t
        .chars()
        .skip_while(|c| !c.is_alphabetic())
        .take_while(|c| c.is_alphabetic())
        .collect::<String>()
        .to_lowercase();
    QUESTION_WORDS.contains(&first.as_str())
}

const LIGHT_MIN_OVERLAP: f64 = 0.8;
const MEDIUM_MIN_OVERLAP: f64 = 0.6;

const NUMBER_WORDS: &[&str] = &[
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
    "twenty",
    "thirty",
    "forty",
    "fifty",
    "sixty",
    "seventy",
    "eighty",
    "ninety",
    "hundred",
    "thousand",
    "million",
    "billion",
    "first",
    "second",
    "third",
    "half",
    "quarter",
    "dozen",
    "once",
    "twice",
];

/// Lowercase alphanumeric words of `s`. Snippet placeholders (`⟦S1⟧`) are dropped and
/// apostrophes removed ("let's" -> "lets"), so contractions compare equal.
fn words_of(s: &str) -> Vec<String> {
    static PLACEHOLDER: once_cell::sync::Lazy<regex::Regex> =
        once_cell::sync::Lazy::new(|| regex::Regex::new(r"⟦S\d+⟧").expect("valid regex"));
    let s = PLACEHOLDER.replace_all(s, " ").to_lowercase();
    let s: String = s
        .chars()
        .filter(|c| !matches!(c, '\'' | '\u{2019}'))
        .collect();
    s.split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(str::to_string)
        .collect()
}

fn is_number_token(w: &str) -> bool {
    w.chars().all(|c| c.is_ascii_digit()) || NUMBER_WORDS.contains(&w)
}

/// Share of the output's words that also occur in the input. A cleanup only re-spells,
/// removes or re-punctuates the speaker's own words; an answer to a dictated instruction
/// is made of new words. Number tokens match when the input has any number token
/// ("two" -> "2"), which keeps this simple.
fn overlap_share(input: &str, output: &str, dict_words: &[String]) -> f64 {
    let in_words = words_of(input);
    let out_words = words_of(output);
    if out_words.is_empty() {
        return 1.0;
    }
    let dict_tokens: Vec<String> = dict_words.iter().flat_map(|w| words_of(w)).collect();
    let in_set: std::collections::HashSet<&str> = in_words
        .iter()
        .chain(dict_tokens.iter())
        .map(String::as_str)
        .collect();
    let in_has_number = in_words.iter().any(|w| is_number_token(w));
    let matched = out_words
        .iter()
        .filter(|w| in_set.contains(w.as_str()) || (in_has_number && is_number_token(w)))
        .count();
    matched as f64 / out_words.len() as f64
}

/// Is the model's output an acceptable replacement for `input`? `input` is the text that was
/// sent (snippet placeholders included); `map` the placeholder table. A rejection means "fall
/// back to local cleanup".
pub fn accept_ai_output(
    input: &str,
    output: &str,
    kind: AiKind,
    level: CleanupLevel,
    map: &[(String, String)],
) -> bool {
    accept_ai_output_with_dict(input, output, kind, level, map, &[])
}

/// Like [`accept_ai_output`], but tokens of the user's dictionary words count as present in
/// the input for the cleanup overlap check (a corrected spelling such as "Kubernetes" for
/// "cooper netties" is the speaker's own word).
pub fn accept_ai_output_with_dict(
    input: &str,
    output: &str,
    kind: AiKind,
    level: CleanupLevel,
    map: &[(String, String)],
    dict_words: &[String],
) -> bool {
    let out = output.trim();
    if out.is_empty() || !placeholders_intact(out, map) {
        return false;
    }
    let (in_len, out_len) = (input.trim().chars().count(), out.chars().count());
    match kind {
        AiKind::Cleanup => {
            let (ratio, slack, min_overlap) = match level {
                CleanupLevel::Medium => (1.5, 40.0, MEDIUM_MIN_OVERLAP),
                CleanupLevel::Light | CleanupLevel::Off => (1.25, 30.0, LIGHT_MIN_OVERLAP),
            };
            if out_len as f64 > ratio * in_len as f64 + slack {
                return false;
            }
            // The safety net against answers: a cleanup reuses the speaker's own words.
            if overlap_share(input, out, dict_words) < min_overlap {
                return false;
            }
            // A dictated question must come back as a question, not an answer.
            !(looks_like_question(input) && !out.contains('?'))
        }
        AiKind::Enhance => out_len <= 4 * in_len + 400,
        AiKind::Command => true,
    }
}

/// Very-casual styling lowercases the whole text, including `⟦S1⟧`; put the `S` back.
fn fix_placeholder_case(text: &str) -> String {
    static RE: once_cell::sync::Lazy<regex::Regex> =
        once_cell::sync::Lazy::new(|| regex::Regex::new(r"⟦s(\d+)⟧").expect("valid regex"));
    RE.replace_all(text, "⟦S${1}⟧").into_owned()
}

/// The offline path: cleanup, style, snippet restore, dictionary replacements. Style runs
/// before restore/replacements so lowercasing never mangles URLs, emails or dictionary casing.
pub fn finalize_local(
    text: &str,
    style: StyleKind,
    dict: &[DictEntry],
    map: &[(String, String)],
) -> String {
    let cleaned = local_cleanup(text);
    let styled = fix_placeholder_case(&apply_style_local(&cleaned, style));
    apply_replacements(&restore(&styled, map), dict)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::text::snippets::protect;

    fn snip(trigger: &str, exp: &str) -> Snippet {
        Snippet {
            id: 1,
            trigger: trigger.into(),
            expansion: exp.into(),
        }
    }

    fn plan(text: &str, mode: Mode, level: CleanupLevel, key: bool) -> Route {
        plan_route(text, false, mode, level, key, Category::Other, &[], &[])
    }

    #[test]
    fn empty_or_artifact_only_text_is_nothing() {
        for t in ["", "   ", "[BLANK_AUDIO]", "(music)"] {
            assert_eq!(
                plan(t, Mode::Dictate, CleanupLevel::Light, true),
                Route::Nothing,
                "{t:?}"
            );
        }
    }

    #[test]
    fn silent_audio_is_nothing_even_with_text() {
        let r = plan_route(
            "Thank you.",
            true,
            Mode::Dictate,
            CleanupLevel::Light,
            true,
            Category::Other,
            &[],
            &[],
        );
        assert_eq!(r, Route::Nothing);
    }

    #[test]
    fn command_needs_a_key() {
        assert_eq!(
            plan("make it shorter", Mode::Command, CleanupLevel::Light, true),
            Route::Claude(AiKind::Command)
        );
        assert_eq!(
            plan("make it shorter", Mode::Command, CleanupLevel::Light, false),
            Route::Nothing
        );
    }

    #[test]
    fn whole_snippet_match_skips_the_ai() {
        let s = [snip("my email", "me@example.com")];
        let r = plan_route(
            "My email.",
            false,
            Mode::Dictate,
            CleanupLevel::Medium,
            true,
            Category::Email,
            &[Category::Email],
            &s,
        );
        assert_eq!(r, Route::SnippetOnly("me@example.com".into()));
        // Snippet-only also beats enhance mode.
        let r = plan_route(
            "my email",
            false,
            Mode::DictateEnhance,
            CleanupLevel::Light,
            true,
            Category::Other,
            &[],
            &s,
        );
        assert_eq!(r, Route::SnippetOnly("me@example.com".into()));
    }

    #[test]
    fn snippet_trigger_inside_a_sentence_is_not_snippet_only() {
        let s = [snip("my email", "me@example.com")];
        let r = plan_route(
            "send it to my email please",
            false,
            Mode::Dictate,
            CleanupLevel::Light,
            true,
            Category::Other,
            &[],
            &s,
        );
        assert_eq!(r, Route::Claude(AiKind::Cleanup));
    }

    #[test]
    fn enhance_mode_and_auto_enhance_categories() {
        assert_eq!(
            plan("hello there", Mode::DictateEnhance, CleanupLevel::Off, true),
            Route::Claude(AiKind::Enhance)
        );
        assert_eq!(
            plan(
                "hello there",
                Mode::DictateEnhance,
                CleanupLevel::Light,
                false
            ),
            Route::Local
        );
        let r = plan_route(
            "hello there",
            false,
            Mode::Dictate,
            CleanupLevel::Off,
            true,
            Category::AiPrompt,
            &[Category::AiPrompt],
            &[],
        );
        assert_eq!(r, Route::Claude(AiKind::Enhance));
        let r = plan_route(
            "hello there",
            false,
            Mode::Dictate,
            CleanupLevel::Light,
            false,
            Category::AiPrompt,
            &[Category::AiPrompt],
            &[],
        );
        assert_eq!(r, Route::Local);
        // A category not in the list is plain cleanup.
        let r = plan_route(
            "hello there",
            false,
            Mode::Dictate,
            CleanupLevel::Light,
            true,
            Category::Email,
            &[Category::AiPrompt],
            &[],
        );
        assert_eq!(r, Route::Claude(AiKind::Cleanup));
    }

    #[test]
    fn level_off_or_no_key_is_local() {
        assert_eq!(
            plan("hi", Mode::Dictate, CleanupLevel::Off, true),
            Route::Local
        );
        assert_eq!(
            plan("hi", Mode::Dictate, CleanupLevel::Medium, false),
            Route::Local
        );
        assert_eq!(
            plan("hi", Mode::Dictate, CleanupLevel::Light, true),
            Route::Claude(AiKind::Cleanup)
        );
    }

    #[test]
    fn rejects_an_answer_to_a_dictated_question() {
        assert!(!accept_ai_output(
            "what's the capital of france",
            "The capital of France is Paris.",
            AiKind::Cleanup,
            CleanupLevel::Light,
            &[]
        ));
        assert!(accept_ai_output(
            "what's the capital of france",
            "What's the capital of France?",
            AiKind::Cleanup,
            CleanupLevel::Light,
            &[]
        ));
        assert!(!accept_ai_output(
            "is this working",
            "Yes, it is working.",
            AiKind::Cleanup,
            CleanupLevel::Light,
            &[]
        ));
        assert!(!accept_ai_output(
            "fine?",
            "Fine.",
            AiKind::Cleanup,
            CleanupLevel::Light,
            &[]
        ));
    }

    fn ok(input: &str, output: &str, level: CleanupLevel) -> bool {
        accept_ai_output(input, output, AiKind::Cleanup, level, &[])
    }

    #[test]
    fn dictionary_words_count_as_overlap() {
        let (input, output) = ("cooper netties", "Kubernetes.");
        let l = CleanupLevel::Light;
        // Control: without the dictionary entry the corrected word is judged by the normal rule.
        assert!(!ok(input, output, l));
        assert!(!accept_ai_output_with_dict(
            input,
            output,
            AiKind::Cleanup,
            l,
            &[],
            &["Aaditya".to_string()]
        ));
        assert!(accept_ai_output_with_dict(
            input,
            output,
            AiKind::Cleanup,
            l,
            &[],
            &["Kubernetes".to_string()]
        ));
        // Multi-token dictionary words match per token.
        assert!(accept_ai_output_with_dict(
            "open ai is hiring",
            "OpenAI Inc is hiring.",
            AiKind::Cleanup,
            l,
            &[],
            &["Inc OpenAI".to_string()]
        ));
        // Dictionary words do not excuse an answer.
        assert!(!accept_ai_output_with_dict(
            "what is kubernetes",
            "Kubernetes is a container orchestration system that automates deployment.",
            AiKind::Cleanup,
            l,
            &[],
            &["Kubernetes".to_string()]
        ));
    }

    #[test]
    fn overlap_guard_accepts_legitimate_cleanups() {
        let l = CleanupLevel::Light;
        assert!(ok(
            "um so i think uh we should go actually no lets stay",
            "So I think we should stay.",
            l
        ));
        assert!(ok("coffee at two actually three", "Coffee at 3.", l));
        assert!(ok(
            "hey can you send me the report by friday thanks",
            "Hey, can you send me the report by Friday? Thanks.",
            l
        ));
        // The cleaned form of instruction-style prompts is exactly what we want.
        assert!(ok(
            "write me a short poem about the ocean",
            "Write me a short poem about the ocean.",
            l
        ));
        assert!(ok(
            "explain what a hash map is",
            "Explain what a hash map is.",
            l
        ));
        assert!(ok(
            "create a python function that reverses a string",
            "Create a Python function that reverses a string.",
            l
        ));
        assert!(ok(
            "give me three ideas for a birthday party",
            "Give me three ideas for a birthday party.",
            l
        ));
        // Spoken punctuation and structure words are removed by cleanup.
        assert!(ok(
            "hello comma how are you question mark new line fine",
            "Hello, how are you?\nFine.",
            l
        ));
    }

    #[test]
    fn overlap_guard_rejects_answers_to_instructions() {
        let l = CleanupLevel::Light;
        assert!(!ok(
            "write me a short poem about the ocean",
            "Waves crash softly on the shore, / The ocean whispers evermore.",
            l
        ));
        assert!(!ok(
            "explain what a hash map is",
            "A hash map is a data structure that maps keys to values using a hash function.",
            l
        ));
        assert!(!ok(
            "create a python function that reverses a string",
            "def reverse(s):\n    return s[::-1]",
            l
        ));
        assert!(!ok(
            "give me three ideas for a birthday party",
            "1. Picnic in the park\n2. Karaoke night\n3. Escape room",
            l
        ));
    }

    #[test]
    fn overlap_guard_is_looser_for_medium_but_still_rejects_answers() {
        // 6 of 9 output words come from the input: fails Light (0.8), passes Medium (0.6).
        let input = "so basically we need to move the launch to next week";
        let out = "We need to postpone the launch by a week.";
        assert!(!ok(input, out, CleanupLevel::Light));
        assert!(ok(input, out, CleanupLevel::Medium));
        assert!(!ok(
            "explain what a hash map is",
            "A hash map is a data structure that maps keys to values using a hash function.",
            CleanupLevel::Medium
        ));
    }

    #[test]
    fn light_length_cap_is_tight() {
        // 20-char input: cap is 1.25 * 20 + 30 = 55 chars.
        let input = "ship it on thursday!";
        let within = "ship it on thursday ship it on thursday ship it"; // 47 chars, all words overlap
        let over = "ship it on thursday ship it on thursday ship it on thursday ship it"; // 67
        assert!(ok(input, within, CleanupLevel::Light));
        assert!(!ok(input, over, CleanupLevel::Light));
        assert!(ok(input, over, CleanupLevel::Medium)); // 1.5 * 20 + 40 = 70
    }

    #[test]
    fn accepts_a_normal_cleanup() {
        assert!(accept_ai_output(
            "um so I think we should ship on thursday",
            "I think we should ship on Thursday.",
            AiKind::Cleanup,
            CleanupLevel::Light,
            &[]
        ));
    }

    #[test]
    fn rejects_empty_and_overlong_cleanup() {
        assert!(!accept_ai_output(
            "hello",
            "   ",
            AiKind::Cleanup,
            CleanupLevel::Light,
            &[]
        ));
        let input = "ship it on thursday";
        let long =
            "Here is a much longer reply that expands on the input considerably and keeps going.";
        assert!(!accept_ai_output(
            input,
            long,
            AiKind::Cleanup,
            CleanupLevel::Light,
            &[]
        ));
        // Same length budget is fine for enhance (4x + 400).
        assert!(accept_ai_output(
            input,
            long,
            AiKind::Enhance,
            CleanupLevel::Light,
            &[]
        ));
        let huge = "x".repeat(4 * input.len() + 401);
        assert!(!accept_ai_output(
            input,
            &huge,
            AiKind::Enhance,
            CleanupLevel::Light,
            &[]
        ));
    }

    #[test]
    fn rejects_missing_or_invented_placeholders() {
        let s = [snip("my email", "me@example.com")];
        let (prot, map) = protect("send it to my email thanks", &s);
        assert!(prot.contains("⟦S1⟧"));
        assert!(accept_ai_output(
            &prot,
            "Send it to ⟦S1⟧, thanks.",
            AiKind::Cleanup,
            CleanupLevel::Light,
            &map
        ));
        assert!(!accept_ai_output(
            &prot,
            "Send it to my email, thanks.",
            AiKind::Cleanup,
            CleanupLevel::Light,
            &map
        ));
        assert!(!accept_ai_output(
            &prot,
            "Send it to ⟦S1⟧ ⟦S1⟧, thanks.",
            AiKind::Cleanup,
            CleanupLevel::Light,
            &map
        ));
        assert!(!accept_ai_output(
            &prot,
            "Send it to ⟦S1⟧ ⟦S2⟧.",
            AiKind::Cleanup,
            CleanupLevel::Light,
            &map
        ));
    }

    #[test]
    fn command_output_only_needs_to_be_non_empty() {
        assert!(accept_ai_output(
            "make it shorter",
            "Short.",
            AiKind::Command,
            CleanupLevel::Light,
            &[]
        ));
        assert!(!accept_ai_output(
            "make it shorter",
            "",
            AiKind::Command,
            CleanupLevel::Light,
            &[]
        ));
    }

    #[test]
    fn question_detection_handles_contractions_and_punctuation() {
        assert!(looks_like_question("What's up"));
        assert!(looks_like_question("  \"Where did it go"));
        assert!(looks_like_question("anything?"));
        assert!(!looks_like_question("ship it today"));
        assert!(!looks_like_question("whatever works"));
    }

    #[test]
    fn finalize_local_applies_style_replacements_and_restores_snippets() {
        let dict = [DictEntry {
            id: 1,
            word: "Kubernetes".into(),
            heard_as: Some("cooper netties".into()),
            auto: false,
        }];
        let s = [snip("my site", "https://Example.com/Path")];
        let (prot, map) = protect("um deploy to cooper netties and see my site", &s);
        let out = finalize_local(&prot, StyleKind::VeryCasual, &dict, &map);
        assert_eq!(out, "deploy to Kubernetes and see https://Example.com/Path");
    }

    #[test]
    fn finalize_local_formal_adds_capital_and_period() {
        let out = finalize_local("um hello there", StyleKind::Formal, &[], &[]);
        assert_eq!(out, "Hello there.");
    }
}
