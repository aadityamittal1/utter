//! Shared text-domain types used across the app and the IPC contract.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Category {
    Email,
    WorkChat,
    PersonalChat,
    AiPrompt,
    Code,
    Document,
    #[default]
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StyleKind {
    #[default]
    Formal,
    Casual,
    VeryCasual,
    Excited,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CleanupLevel {
    Off,
    #[default]
    Light,
    Medium,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictEntry {
    pub id: i64,
    pub word: String,
    /// The misheard form to replace with `word`.
    pub heard_as: Option<String>,
    pub auto: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snippet {
    pub id: i64,
    pub trigger: String,
    pub expansion: String,
}

/// Number of whitespace-separated tokens in `s`.
pub fn word_count(s: &str) -> u32 {
    s.split_whitespace().count() as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn word_count_counts_whitespace_tokens() {
        assert_eq!(word_count(""), 0);
        assert_eq!(word_count("   "), 0);
        assert_eq!(word_count("hello"), 1);
        assert_eq!(word_count("  hello \n world\tagain "), 3);
    }

    #[test]
    fn enums_serialize_camel_case_with_defaults() {
        assert_eq!(
            serde_json::to_string(&Category::WorkChat).unwrap(),
            "\"workChat\""
        );
        assert_eq!(
            serde_json::to_string(&StyleKind::VeryCasual).unwrap(),
            "\"veryCasual\""
        );
        assert_eq!(
            serde_json::to_string(&CleanupLevel::Medium).unwrap(),
            "\"medium\""
        );
        assert_eq!(Category::default(), Category::Other);
        assert_eq!(StyleKind::default(), StyleKind::Formal);
        assert_eq!(CleanupLevel::default(), CleanupLevel::Light);
    }

    #[test]
    fn dict_entry_uses_camel_case_keys() {
        let e = DictEntry {
            id: 1,
            word: "Utter".into(),
            heard_as: Some("udder".into()),
            auto: false,
        };
        let v = serde_json::to_value(&e).unwrap();
        assert_eq!(v["heardAs"], "udder");
    }
}
