//! Settings (and transform shortcuts) -> hotkey matcher bindings.

use crate::hotkeys::action::Action;
use crate::hotkeys::chord::Chord;
use crate::hotkeys::matcher::{Binding, Trigger};
use crate::settings::Settings;
use crate::store::Transform;
use std::collections::BTreeMap;

fn trigger_for(action: &Action) -> Trigger {
    match action {
        Action::Dictate | Action::DictateEnhance | Action::Command => Trigger::Hold,
        Action::HandsFree => Trigger::Toggle,
        _ => Trigger::Press,
    }
}

/// A transform's own `shortcut` (edited on the Transforms page) overrides the settings entry
/// for `transform:<id>`; custom transforms with a shortcut get a binding even when settings
/// has none. Unparseable chords are skipped (logged without the chord text being trusted).
pub fn build_bindings(settings: &Settings, transforms: &[Transform]) -> Vec<Binding> {
    let mut map: BTreeMap<Action, Vec<String>> = settings.shortcuts.clone();
    for t in transforms {
        if let Some(sc) = t.shortcut.as_ref().filter(|s| !s.trim().is_empty()) {
            map.insert(Action::Transform(t.id.clone()), vec![sc.clone()]);
        }
    }
    let mut out = Vec::new();
    for (action, chords) in map {
        for c in chords {
            match Chord::parse(&c) {
                Ok(chord) => out.push(Binding {
                    trigger: trigger_for(&action),
                    action: action.clone(),
                    chord,
                }),
                Err(e) => log::warn!("ignoring shortcut for {action}: {e}"),
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tf(id: &str, shortcut: Option<&str>) -> Transform {
        Transform {
            id: id.into(),
            name: id.into(),
            instruction: "x".into(),
            shortcut: shortcut.map(Into::into),
            builtin: false,
        }
    }

    #[test]
    fn defaults_produce_ten_bindings_with_right_triggers() {
        let b = build_bindings(&Settings::default(), &[]);
        assert_eq!(b.len(), 10);
        let t = |a: Action| b.iter().find(|x| x.action == a).unwrap().trigger;
        assert_eq!(t(Action::Dictate), Trigger::Hold);
        assert_eq!(t(Action::Command), Trigger::Hold);
        assert_eq!(t(Action::DictateEnhance), Trigger::Hold);
        assert_eq!(t(Action::HandsFree), Trigger::Toggle);
        assert_eq!(t(Action::Cancel), Trigger::Press);
        assert_eq!(t(Action::Transform("polish".into())), Trigger::Press);
    }

    #[test]
    fn empty_and_invalid_chords_are_skipped() {
        let mut s = Settings::default();
        s.shortcuts.insert(Action::CopyLast, vec![]);
        s.shortcuts.insert(Action::PasteLast, vec!["Bogus+Key".into()]);
        let b = build_bindings(&s, &[]);
        assert!(!b.iter().any(|x| x.action == Action::CopyLast));
        assert!(!b.iter().any(|x| x.action == Action::PasteLast));
    }

    #[test]
    fn transform_shortcut_overrides_and_adds() {
        let s = Settings::default();
        let b = build_bindings(
            &s,
            &[tf("polish", Some("Alt+Shift+9")), tf("tabc", Some("Alt+Shift+8"))],
        );
        let find = |id: &str| {
            b.iter()
                .find(|x| x.action == Action::Transform(id.into()))
                .map(|x| x.chord.to_string())
        };
        assert_eq!(find("polish").as_deref(), Some("Alt+Shift+9"));
        assert_eq!(find("tabc").as_deref(), Some("Alt+Shift+8"));
        assert_eq!(find("prompt").as_deref(), Some("Alt+Shift+2"));
    }
}
