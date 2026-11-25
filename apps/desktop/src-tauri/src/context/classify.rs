//! Foreground-app classification into a `Category`.

use crate::text::types::Category;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppInfo {
    pub process: String,
    pub title: String,
    pub hwnd: isize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryRule {
    pub category: Category,
    pub process: Option<String>,
    pub title_contains: Option<String>,
}

/// Title-based built-ins: (substring, display name, category). Checked before process rules,
/// so a browser tab titled "Inbox - Gmail" wins over `chrome.exe`.
const TITLE_RULES: &[(&str, &str, Category)] = &[
    ("gmail", "Gmail", Category::Email),
    ("slack", "Slack", Category::WorkChat),
    ("microsoft teams", "Teams", Category::WorkChat),
    ("whatsapp", "WhatsApp", Category::PersonalChat),
    ("messenger", "Messenger", Category::PersonalChat),
    ("chatgpt", "ChatGPT", Category::AiPrompt),
    ("claude", "Claude", Category::AiPrompt),
    ("gemini", "Gemini", Category::AiPrompt),
    ("perplexity", "Perplexity", Category::AiPrompt),
    ("google docs", "Google Docs", Category::Document),
];

const PROCESS_RULES: &[(&str, Category)] = &[
    ("outlook.exe", Category::Email),
    ("olk.exe", Category::Email),
    ("thunderbird.exe", Category::Email),
    ("slack.exe", Category::WorkChat),
    ("teams.exe", Category::WorkChat),
    ("ms-teams.exe", Category::WorkChat),
    ("discord.exe", Category::PersonalChat),
    ("whatsapp.exe", Category::PersonalChat),
    ("telegram.exe", Category::PersonalChat),
    ("claude.exe", Category::AiPrompt),
    ("code.exe", Category::Code),
    ("cursor.exe", Category::Code),
    ("windsurf.exe", Category::Code),
    ("devenv.exe", Category::Code),
    ("idea64.exe", Category::Code),
    ("windowsterminal.exe", Category::Code),
    ("conhost.exe", Category::Code),
    ("wezterm-gui.exe", Category::Code),
    ("alacritty.exe", Category::Code),
    ("mintty.exe", Category::Code),
    ("powershell.exe", Category::Code),
    ("pwsh.exe", Category::Code),
    ("cmd.exe", Category::Code),
    ("winword.exe", Category::Document),
    ("notion.exe", Category::Document),
    ("obsidian.exe", Category::Document),
];

const BROWSERS: &[&str] = &[
    "chrome.exe",
    "msedge.exe",
    "firefox.exe",
    "brave.exe",
    "opera.exe",
    "vivaldi.exe",
    "arc.exe",
];

const APP_NAMES: &[(&str, &str)] = &[
    ("winword.exe", "Word"),
    ("excel.exe", "Excel"),
    ("powerpnt.exe", "PowerPoint"),
    ("outlook.exe", "Outlook"),
    ("olk.exe", "Outlook"),
    ("ms-teams.exe", "Teams"),
    ("teams.exe", "Teams"),
    ("windowsterminal.exe", "Terminal"),
    ("code.exe", "VS Code"),
    ("notepad.exe", "Notepad"),
    ("devenv.exe", "Visual Studio"),
    ("idea64.exe", "IntelliJ IDEA"),
    ("wezterm-gui.exe", "WezTerm"),
    ("conhost.exe", "Console"),
    ("pwsh.exe", "PowerShell"),
    ("powershell.exe", "PowerShell"),
    ("cmd.exe", "Command Prompt"),
];

fn is_code_process(p: &str) -> bool {
    PROCESS_RULES
        .iter()
        .any(|(n, c)| *c == Category::Code && *n == p)
}

/// Built-in rules, in order: (1) Code process rules (editors/terminals, so a file or tab
/// titled "claude.md" inside VS Code stays Code), (2) title rules, (3) other process rules.
pub fn default_rules() -> Vec<CategoryRule> {
    let proc_rule = |p: &str, c: Category| CategoryRule {
        category: c,
        process: Some(p.to_string()),
        title_contains: None,
    };
    let code = PROCESS_RULES
        .iter()
        .filter(|(p, _)| is_code_process(p))
        .map(|(p, c)| proc_rule(p, *c));
    let titles = TITLE_RULES.iter().map(|(t, _, c)| CategoryRule {
        category: *c,
        process: None,
        title_contains: Some((*t).to_string()),
    });
    let rest = PROCESS_RULES
        .iter()
        .filter(|(p, _)| !is_code_process(p))
        .map(|(p, c)| proc_rule(p, *c));
    code.chain(titles).chain(rest).collect()
}

fn rule_matches(rule: &CategoryRule, app: &AppInfo) -> bool {
    if rule.process.is_none() && rule.title_contains.is_none() {
        return false;
    }
    let process_ok = rule
        .process
        .as_ref()
        .is_none_or(|p| p.to_lowercase() == app.process.to_lowercase());
    let title_ok = rule
        .title_contains
        .as_ref()
        .is_none_or(|t| app.title.to_lowercase().contains(&t.to_lowercase()));
    process_ok && title_ok
}

/// First matching rule wins (caller supplies order; `default_rules` puts title rules first).
/// Matching is case-insensitive; no match -> `Other`.
pub fn classify(app: &AppInfo, rules: &[CategoryRule]) -> Category {
    rules
        .iter()
        .find(|r| rule_matches(r, app))
        .map(|r| r.category)
        .unwrap_or(Category::Other)
}

/// Friendly app name: for browsers, a known site from the title (e.g. "Gmail"); for other
/// apps a known-app map ("VS Code"); else the exe stem title-cased (`chrome.exe` -> "Chrome").
pub fn display_name(app: &AppInfo) -> String {
    let lower = app.process.to_lowercase();
    if BROWSERS.contains(&lower.as_str()) {
        let title = app.title.to_lowercase();
        if let Some((_, name, _)) = TITLE_RULES.iter().find(|(t, _, _)| title.contains(t)) {
            return (*name).to_string();
        }
    } else if let Some((_, name)) = APP_NAMES.iter().find(|(p, _)| *p == lower) {
        return (*name).to_string();
    }
    let stem = lower.strip_suffix(".exe").unwrap_or(&lower);
    let mut chars = stem.chars();
    match chars.next() {
        Some(f) => f.to_uppercase().collect::<String>() + chars.as_str(),
        None => "Unknown".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app(process: &str, title: &str) -> AppInfo {
        AppInfo {
            process: process.into(),
            title: title.into(),
            hwnd: 0,
        }
    }
    fn c(process: &str, title: &str) -> Category {
        classify(&app(process, title), &default_rules())
    }

    #[test]
    fn email() {
        assert_eq!(c("chrome.exe", "Inbox - Gmail"), Category::Email);
        for p in ["outlook.exe", "olk.exe", "thunderbird.exe"] {
            assert_eq!(c(p, "x"), Category::Email, "{p}");
        }
    }

    #[test]
    fn chats() {
        for p in ["slack.exe", "teams.exe", "ms-teams.exe"] {
            assert_eq!(c(p, "x"), Category::WorkChat, "{p}");
        }
        assert_eq!(c("firefox.exe", "Slack | general"), Category::WorkChat);
        for p in ["discord.exe", "whatsapp.exe", "telegram.exe"] {
            assert_eq!(c(p, "x"), Category::PersonalChat, "{p}");
        }
        assert_eq!(c("chrome.exe", "WhatsApp"), Category::PersonalChat);
        assert_eq!(c("chrome.exe", "Messenger"), Category::PersonalChat);
    }

    #[test]
    fn ai_prompt() {
        for t in ["ChatGPT", "Claude", "Gemini", "Perplexity"] {
            assert_eq!(c("chrome.exe", t), Category::AiPrompt, "{t}");
        }
        assert_eq!(c("claude.exe", "x"), Category::AiPrompt);
    }

    #[test]
    fn code_and_docs() {
        for p in [
            "code.exe",
            "cursor.exe",
            "windsurf.exe",
            "devenv.exe",
            "idea64.exe",
            "windowsterminal.exe",
            "wezterm-gui.exe",
        ] {
            assert_eq!(c(p, "x"), Category::Code, "{p}");
        }
        for p in ["winword.exe", "notion.exe", "obsidian.exe"] {
            assert_eq!(c(p, "x"), Category::Document, "{p}");
        }
        assert_eq!(
            c("chrome.exe", "Untitled - Google Docs"),
            Category::Document
        );
        assert_eq!(c("notepad.exe", "Untitled"), Category::Other);
    }

    #[test]
    fn title_beats_process_and_case_insensitive() {
        assert_eq!(c("chrome.exe", "Slack"), Category::WorkChat);
        assert_eq!(c("OUTLOOK.EXE", "x"), Category::Email);
        assert_eq!(c("chrome.exe", "inbox - GMAIL"), Category::Email);
    }

    #[test]
    fn custom_rules_first_match_and_empty_rule_ignored() {
        let rules = vec![
            CategoryRule {
                category: Category::Email,
                process: None,
                title_contains: None,
            },
            CategoryRule {
                category: Category::Code,
                process: Some("notepad.exe".into()),
                title_contains: None,
            },
        ];
        assert_eq!(classify(&app("notepad.exe", ""), &rules), Category::Code);
        assert_eq!(classify(&app("x.exe", ""), &[]), Category::Other);
    }

    #[test]
    fn rule_with_both_fields_needs_both() {
        let rules = vec![CategoryRule {
            category: Category::Email,
            process: Some("chrome.exe".into()),
            title_contains: Some("work".into()),
        }];
        assert_eq!(
            classify(&app("chrome.exe", "My Work"), &rules),
            Category::Email
        );
        assert_eq!(
            classify(&app("chrome.exe", "Home"), &rules),
            Category::Other
        );
        assert_eq!(
            classify(&app("edge.exe", "My Work"), &rules),
            Category::Other
        );
    }

    #[test]
    fn display_names() {
        assert_eq!(
            display_name(&app("chrome.exe", "Inbox - Gmail - Google Chrome")),
            "Gmail"
        );
        assert_eq!(display_name(&app("chrome.exe", "Some page")), "Chrome");
        assert_eq!(display_name(&app("WINWORD.EXE", "Doc1")), "Word");
        assert_eq!(
            display_name(&app("code.exe", "claude.md - Visual Studio Code")),
            "VS Code"
        );
        assert_eq!(
            display_name(&app("windowsterminal.exe", "claude")),
            "Terminal"
        );
        assert_eq!(display_name(&app("msedge.exe", "Slack | general")), "Slack");
        assert_eq!(display_name(&app("zed.exe", "x")), "Zed");
    }

    #[test]
    fn editors_and_terminals_beat_title_rules() {
        assert_eq!(
            c("code.exe", "claude.md - utter - Visual Studio Code"),
            Category::Code
        );
        assert_eq!(c("code.exe", "slack-notifier.ts - utter"), Category::Code);
        assert_eq!(c("windowsterminal.exe", "claude"), Category::Code);
        assert_eq!(c("chrome.exe", "Slack"), Category::WorkChat);
        assert_eq!(display_name(&app("", "")), "Unknown");
    }
}
