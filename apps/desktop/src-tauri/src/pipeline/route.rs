//! Pure routing and output-acceptance rules for the dictation pipeline.

use crate::text::local_cleanup::local_cleanup;
use crate::text::dictionary::apply_replacements;
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
    "what", "why", "how", "when", "where", "who", "which", "can", "could", "would", "should",
    "is", "are", "do", "does", "did", "will",
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

/// Is the model's output an acceptable replacement for `input`? `input` is the text that was
/// sent (snippet placeholders included); `map` the placeholder table. A rejection means "fall
/// back to local cleanup".
pub fn accept_ai_output(input: &str, output: &str, kind: AiKind, map: &[(String, String)]) -> bool {
    let out = output.trim();
    if out.is_empty() || !placeholders_intact(out, map) {
        return false;
    }
    let (in_len, out_len) = (input.trim().chars().count(), out.chars().count());
    match kind {
        AiKind::Cleanup => {
            if out_len as f64 > 1.5 * in_len as f64 + 40.0 {
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
            assert_eq!(plan(t, Mode::Dictate, CleanupLevel::Light, true), Route::Nothing, "{t:?}");
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
            plan("hello there", Mode::DictateEnhance, CleanupLevel::Light, false),
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
        assert_eq!(plan("hi", Mode::Dictate, CleanupLevel::Off, true), Route::Local);
        assert_eq!(plan("hi", Mode::Dictate, CleanupLevel::Medium, false), Route::Local);
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
            &[]
        ));
        assert!(accept_ai_output(
            "what's the capital of france",
            "What's the capital of France?",
            AiKind::Cleanup,
            &[]
        ));
        assert!(!accept_ai_output("is this working", "Yes, it is working.", AiKind::Cleanup, &[]));
        assert!(!accept_ai_output("fine?", "Fine.", AiKind::Cleanup, &[]));
    }

    #[test]
    fn accepts_a_normal_cleanup() {
        assert!(accept_ai_output(
            "um so I think we should ship on thursday",
            "I think we should ship on Thursday.",
            AiKind::Cleanup,
            &[]
        ));
    }

    #[test]
    fn rejects_empty_and_overlong_cleanup() {
        assert!(!accept_ai_output("hello", "   ", AiKind::Cleanup, &[]));
        let input = "ship it on thursday";
        let long = "Here is a much longer reply that expands on the input considerably and keeps going.";
        assert!(!accept_ai_output(input, long, AiKind::Cleanup, &[]));
        // Same length budget is fine for enhance (4x + 400).
        assert!(accept_ai_output(input, long, AiKind::Enhance, &[]));
        let huge = "x".repeat(4 * input.len() + 401);
        assert!(!accept_ai_output(input, &huge, AiKind::Enhance, &[]));
    }

    #[test]
    fn rejects_missing_or_invented_placeholders() {
        let s = [snip("my email", "me@example.com")];
        let (prot, map) = protect("send it to my email thanks", &s);
        assert!(prot.contains("⟦S1⟧"));
        assert!(accept_ai_output(&prot, "Send it to ⟦S1⟧, thanks.", AiKind::Cleanup, &map));
        assert!(!accept_ai_output(&prot, "Send it to my email, thanks.", AiKind::Cleanup, &map));
        assert!(!accept_ai_output(&prot, "Send it to ⟦S1⟧ ⟦S1⟧, thanks.", AiKind::Cleanup, &map));
        assert!(!accept_ai_output(&prot, "Send it to ⟦S1⟧ ⟦S2⟧.", AiKind::Cleanup, &map));
    }

    #[test]
    fn command_output_only_needs_to_be_non_empty() {
        assert!(accept_ai_output("make it shorter", "Short.", AiKind::Command, &[]));
        assert!(!accept_ai_output("make it shorter", "", AiKind::Command, &[]));
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
