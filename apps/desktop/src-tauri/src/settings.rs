//! User settings: the JSON settings file (never contains the API key).

use crate::context::classify::{default_rules, CategoryRule};
use crate::hotkeys::action::Action;
use crate::store::history::Retention;
use crate::text::types::{Category, CleanupLevel, StyleKind};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Theme {
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub onboarded: bool,
    pub user_name: String,
    pub shortcuts: BTreeMap<Action, Vec<String>>,
    /// Input device name; `None` = system default.
    pub microphone: Option<String>,
    pub keep_mic_warm: bool,
    /// `"auto"` or an ISO 639-1 code.
    pub language: String,
    pub translate_to_english: bool,
    pub active_model: String,
    pub ai_model: String,
    pub cleanup_level: CleanupLevel,
    pub styles: HashMap<Category, StyleKind>,
    pub auto_enhance: Vec<Category>,
    pub context_awareness: bool,
    pub sounds: bool,
    pub show_pill: bool,
    pub launch_at_login: bool,
    pub theme: Theme,
    pub history_retention: Retention,
    pub keep_audio: bool,
    pub category_rules: Vec<CategoryRule>,
}

/// Default chords (Windows).
pub fn default_shortcuts() -> BTreeMap<Action, Vec<String>> {
    let chord = |s: &str| vec![s.to_string()];
    BTreeMap::from([
        (Action::Dictate, chord("Ctrl+Win")),
        (Action::HandsFree, chord("Ctrl+Win+Space")),
        (Action::DictateEnhance, chord("Ctrl+Win+Shift")),
        (Action::Command, chord("Ctrl+Win+Alt")),
        (Action::Cancel, chord("Esc")),
        (Action::PasteLast, chord("Alt+Shift+Z")),
        (Action::CopyLast, chord("Alt+Shift+C")),
        (Action::QuickNote, chord("Alt+Shift+N")),
        (Action::Transform("polish".into()), chord("Alt+Shift+1")),
        (Action::Transform("prompt".into()), chord("Alt+Shift+2")),
    ])
}

pub fn default_styles() -> HashMap<Category, StyleKind> {
    HashMap::from([
        (Category::Email, StyleKind::Formal),
        (Category::WorkChat, StyleKind::Casual),
        (Category::PersonalChat, StyleKind::Casual),
        (Category::AiPrompt, StyleKind::Formal),
        (Category::Code, StyleKind::Formal),
        (Category::Document, StyleKind::Formal),
        (Category::Other, StyleKind::Formal),
    ])
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            onboarded: false,
            user_name: String::new(),
            shortcuts: default_shortcuts(),
            microphone: None,
            keep_mic_warm: false,
            language: "auto".into(),
            translate_to_english: false,
            active_model: "small-q5_1".into(),
            ai_model: "claude-haiku-5-5".into(),
            cleanup_level: CleanupLevel::Light,
            styles: default_styles(),
            auto_enhance: Vec::new(),
            context_awareness: true,
            sounds: true,
            show_pill: true,
            launch_at_login: true,
            theme: Theme::System,
            history_retention: Retention::Forever,
            keep_audio: true,
            category_rules: default_rules(),
        }
    }
}

impl Settings {
    /// Fill categories missing from `styles` with their defaults (a partial map is not an error).
    fn fill_missing_styles(&mut self) {
        for (cat, style) in default_styles() {
            self.styles.entry(cat).or_insert(style);
        }
    }

    /// Give every default action (incl. the built-in transforms) its default chord when the
    /// map has no entry for it. Present entries, even empty ones, are never changed.
    fn fill_missing_shortcuts(&mut self) {
        for (action, chords) in default_shortcuts() {
            self.shortcuts.entry(action).or_insert(chords);
        }
    }

    /// Build settings from a JSON object field by field: a field that fails to parse (wrong
    /// type, unknown enum value from a newer version) falls back to its default and the rest
    /// is kept.
    fn from_object_lenient(file: serde_json::Map<String, serde_json::Value>) -> Settings {
        use serde_json::Value;
        let Ok(Value::Object(mut current)) = serde_json::to_value(Settings::default()) else {
            return Settings::default();
        };
        for (key, val) in file {
            if !current.contains_key(&key) {
                continue; // unknown field: ignore
            }
            let mut candidate = current.clone();
            candidate.insert(key.clone(), val);
            if serde_json::from_value::<Settings>(Value::Object(candidate.clone())).is_ok() {
                current = candidate;
            } else {
                log::warn!("settings field {key:?} is invalid, using its default");
            }
        }
        serde_json::from_value(Value::Object(current)).unwrap_or_default()
    }

    /// Restore the default shortcut map (the `reset_shortcuts` command).
    pub fn reset_shortcuts(&mut self) {
        self.shortcuts = default_shortcuts();
    }
}

/// Load settings. A missing or corrupt file yields defaults; unknown fields are ignored and
/// missing fields take their defaults.
pub fn load(path: &Path) -> Settings {
    let mut s = match std::fs::read_to_string(path) {
        Ok(text) => match serde_json::from_str::<serde_json::Value>(&text) {
            Ok(serde_json::Value::Object(map)) => Settings::from_object_lenient(map),
            _ => {
                // Not usable JSON: keep a copy so the next save doesn't destroy it.
                log::warn!("settings file is corrupt, backing it up and using defaults");
                let mut bak = path.as_os_str().to_owned();
                bak.push(".bak");
                if let Err(e) = std::fs::rename(path, std::path::PathBuf::from(bak)) {
                    log::warn!("could not back up corrupt settings: {e}");
                }
                Settings::default()
            }
        },
        Err(_) => Settings::default(),
    };
    s.fill_missing_styles();
    s.fill_missing_shortcuts();
    s
}

/// Atomic save: write a temp file beside the target, then rename over it.
pub fn save(path: &Path, settings: &Settings) -> Result<()> {
    let dir = path.parent().filter(|p| !p.as_os_str().is_empty());
    if let Some(dir) = dir {
        std::fs::create_dir_all(dir).with_context(|| format!("creating {}", dir.display()))?;
    }
    let json = serde_json::to_vec_pretty(settings)?;
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = std::path::PathBuf::from(tmp);
    std::fs::write(&tmp, json).with_context(|| format!("writing {}", tmp.display()))?;
    std::fs::rename(&tmp, path).with_context(|| format!("replacing {}", path.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_match_spec() {
        let s = Settings::default();
        assert!(!s.onboarded);
        assert_eq!(s.language, "auto");
        assert_eq!(s.ai_model, "claude-haiku-5-5");
        assert_eq!(s.cleanup_level, CleanupLevel::Light);
        assert!(
            s.sounds && s.show_pill && s.context_awareness && s.launch_at_login && s.keep_audio
        );
        assert!(!s.keep_mic_warm && !s.translate_to_english);
        assert_eq!(s.history_retention, Retention::Forever);
        assert_eq!(s.theme, Theme::System);
        assert_eq!(s.styles[&Category::Email], StyleKind::Formal);
        assert_eq!(s.styles[&Category::WorkChat], StyleKind::Casual);
        assert_eq!(s.styles[&Category::PersonalChat], StyleKind::Casual);
        assert_eq!(s.styles[&Category::AiPrompt], StyleKind::Formal);
        assert_eq!(s.styles[&Category::Code], StyleKind::Formal);
        assert_eq!(s.styles[&Category::Document], StyleKind::Formal);
        assert_eq!(s.styles[&Category::Other], StyleKind::Formal);
        assert_eq!(s.category_rules, default_rules());
    }

    #[test]
    fn default_shortcuts_match_constraints() {
        let m = default_shortcuts();
        let get = |a: Action| m[&a].clone();
        assert_eq!(get(Action::Dictate), ["Ctrl+Win"]);
        assert_eq!(get(Action::HandsFree), ["Ctrl+Win+Space"]);
        assert_eq!(get(Action::DictateEnhance), ["Ctrl+Win+Shift"]);
        assert_eq!(get(Action::Command), ["Ctrl+Win+Alt"]);
        assert_eq!(get(Action::Cancel), ["Esc"]);
        assert_eq!(get(Action::PasteLast), ["Alt+Shift+Z"]);
        assert_eq!(get(Action::CopyLast), ["Alt+Shift+C"]);
        assert_eq!(get(Action::QuickNote), ["Alt+Shift+N"]);
        assert_eq!(get(Action::Transform("polish".into())), ["Alt+Shift+1"]);
        assert_eq!(get(Action::Transform("prompt".into())), ["Alt+Shift+2"]);
    }

    #[test]
    fn round_trips_through_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join("settings.json");
        let mut s = Settings::default();
        s.onboarded = true;
        s.user_name = "Ada".into();
        s.microphone = Some("USB Mic".into());
        s.auto_enhance = vec![Category::AiPrompt];
        s.history_retention = Retention::Day;
        s.shortcuts
            .insert(Action::Dictate, vec!["Ctrl+Alt+D".into()]);
        save(&path, &s).unwrap();
        assert_eq!(load(&path), s);
        assert!(!dir.path().join("nested").join("settings.json.tmp").exists());
        // Saving again overwrites.
        s.theme = Theme::Dark;
        save(&path, &s).unwrap();
        assert_eq!(load(&path).theme, Theme::Dark);
    }

    #[test]
    fn missing_file_and_corrupt_file_give_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        assert_eq!(load(&path), Settings::default());
        std::fs::write(&path, "{ not json !!").unwrap();
        assert_eq!(load(&path), Settings::default());
        std::fs::write(&path, "{\"onboarded\": \"yes\"}").unwrap();
        assert_eq!(load(&path), Settings::default(), "wrong type is corrupt");
    }

    #[test]
    fn partial_json_defaults_elsewhere_and_unknown_fields_ignored() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, r#"{ "onboarded": true, "futureField": 42 }"#).unwrap();
        let s = load(&path);
        let mut expected = Settings::default();
        expected.onboarded = true;
        assert_eq!(s, expected);
    }

    #[test]
    fn one_bad_field_only_resets_that_field() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(
            &path,
            r#"{"theme":"neon","onboarded":true,"userName":"Ada","keepAudio":"maybe"}"#,
        )
        .unwrap();
        let s = load(&path);
        assert!(s.onboarded);
        assert_eq!(s.user_name, "Ada");
        assert_eq!(s.theme, Theme::System, "unknown enum value -> default");
        assert!(s.keep_audio, "wrong type -> default (true)");
        assert!(
            !dir.path().join("settings.json.bak").exists(),
            "valid JSON is not backed up"
        );
    }

    #[test]
    fn invalid_json_is_backed_up_before_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, "{ not json !!").unwrap();
        assert_eq!(load(&path), Settings::default());
        let bak = dir.path().join("settings.json.bak");
        assert_eq!(std::fs::read_to_string(bak).unwrap(), "{ not json !!");
        // Non-object JSON counts as unusable too.
        std::fs::write(&path, "[1,2]").unwrap();
        assert_eq!(load(&path), Settings::default());
    }

    #[test]
    fn partial_shortcuts_get_missing_defaults_without_overriding() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(
            &path,
            r#"{"shortcuts":{"dictate":["Ctrl+Alt+D"],"cancel":[]}}"#,
        )
        .unwrap();
        let s = load(&path);
        assert_eq!(
            s.shortcuts[&Action::Dictate],
            ["Ctrl+Alt+D"],
            "present entry kept"
        );
        assert!(
            s.shortcuts[&Action::Cancel].is_empty(),
            "explicitly cleared stays cleared"
        );
        let defaults = default_shortcuts();
        for (a, chords) in &defaults {
            if *a != Action::Dictate && *a != Action::Cancel {
                assert_eq!(&s.shortcuts[a], chords, "{a}");
            }
        }
        assert_eq!(s.shortcuts.len(), defaults.len());
        assert_eq!(
            s.shortcuts[&Action::Transform("polish".into())],
            ["Alt+Shift+1"]
        );
        assert_eq!(
            s.shortcuts[&Action::Transform("prompt".into())],
            ["Alt+Shift+2"]
        );
    }

    #[test]
    fn partial_styles_are_filled_in() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, r#"{ "styles": { "email": "excited" } }"#).unwrap();
        let s = load(&path);
        assert_eq!(s.styles[&Category::Email], StyleKind::Excited);
        assert_eq!(s.styles[&Category::WorkChat], StyleKind::Casual);
        assert_eq!(s.styles.len(), 7);
    }

    #[test]
    fn serializes_per_ipc_contract() {
        let v = serde_json::to_value(Settings::default()).unwrap();
        for k in [
            "onboarded",
            "userName",
            "shortcuts",
            "microphone",
            "keepMicWarm",
            "language",
            "translateToEnglish",
            "activeModel",
            "aiModel",
            "cleanupLevel",
            "styles",
            "autoEnhance",
            "contextAwareness",
            "sounds",
            "showPill",
            "launchAtLogin",
            "theme",
            "historyRetention",
            "keepAudio",
            "categoryRules",
        ] {
            assert!(v.get(k).is_some(), "missing key {k}");
        }
        assert_eq!(v["shortcuts"]["transform:polish"][0], "Alt+Shift+1");
        assert_eq!(v["styles"]["workChat"], "casual");
        assert_eq!(v["historyRetention"], "forever");
        assert_eq!(v["theme"], "system");
    }

    #[test]
    fn reset_shortcuts_restores_defaults() {
        let mut s = Settings::default();
        s.shortcuts.clear();
        s.reset_shortcuts();
        assert_eq!(s.shortcuts, default_shortcuts());
    }
}
