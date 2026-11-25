//! Hotkey actions and their string form (`dictate`, `transform:<id>`, ...).

use serde::{de, Deserialize, Deserializer, Serialize, Serializer};
use std::fmt;
use std::str::FromStr;

#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Action {
    Dictate,
    HandsFree,
    DictateEnhance,
    Command,
    Cancel,
    PasteLast,
    CopyLast,
    QuickNote,
    Transform(String),
}

impl fmt::Display for Action {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Action::Dictate => f.write_str("dictate"),
            Action::HandsFree => f.write_str("handsFree"),
            Action::DictateEnhance => f.write_str("dictateEnhance"),
            Action::Command => f.write_str("command"),
            Action::Cancel => f.write_str("cancel"),
            Action::PasteLast => f.write_str("pasteLast"),
            Action::CopyLast => f.write_str("copyLast"),
            Action::QuickNote => f.write_str("quickNote"),
            Action::Transform(id) => write!(f, "transform:{id}"),
        }
    }
}

impl FromStr for Action {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(match s {
            "dictate" => Action::Dictate,
            "handsFree" => Action::HandsFree,
            "dictateEnhance" => Action::DictateEnhance,
            "command" => Action::Command,
            "cancel" => Action::Cancel,
            "pasteLast" => Action::PasteLast,
            "copyLast" => Action::CopyLast,
            "quickNote" => Action::QuickNote,
            other => match other.strip_prefix("transform:") {
                Some(id) if !id.is_empty() => Action::Transform(id.to_string()),
                _ => return Err(format!("unknown action: {other}")),
            },
        })
    }
}

impl Serialize for Action {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.collect_str(self)
    }
}

impl<'de> Deserialize<'de> for Action {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let s = String::deserialize(d)?;
        s.parse().map_err(de::Error::custom)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn all() -> Vec<Action> {
        vec![
            Action::Dictate,
            Action::HandsFree,
            Action::DictateEnhance,
            Action::Command,
            Action::Cancel,
            Action::PasteLast,
            Action::CopyLast,
            Action::QuickNote,
            Action::Transform("polish".into()),
        ]
    }

    #[test]
    fn round_trips_through_json_strings() {
        for a in all() {
            let json = serde_json::to_string(&a).unwrap();
            assert_eq!(json, format!("\"{a}\""));
            assert_eq!(serde_json::from_str::<Action>(&json).unwrap(), a);
        }
        assert_eq!(
            serde_json::to_string(&Action::Transform("x1".into())).unwrap(),
            "\"transform:x1\""
        );
    }

    #[test]
    fn works_as_json_map_key() {
        let mut m = BTreeMap::new();
        m.insert(Action::Dictate, vec!["Ctrl+Win".to_string()]);
        m.insert(
            Action::Transform("polish".into()),
            vec!["Alt+Shift+1".to_string()],
        );
        let json = serde_json::to_string(&m).unwrap();
        let back: BTreeMap<Action, Vec<String>> = serde_json::from_str(&json).unwrap();
        assert_eq!(back, m);
    }

    #[test]
    fn rejects_unknown_actions() {
        assert!(serde_json::from_str::<Action>("\"nope\"").is_err());
        assert!(serde_json::from_str::<Action>("\"transform:\"").is_err());
    }
}
