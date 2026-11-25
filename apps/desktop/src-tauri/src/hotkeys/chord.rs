//! Key chords: side-agnostic modifiers plus layout-independent virtual-key codes.

use std::collections::BTreeSet;
use std::fmt;
use std::str::FromStr;

/// A single key. Declaration order is the canonical display order
/// (`Ctrl+Win+Alt+Shift+<key>`), because `Ord` is derived.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Key {
    Ctrl,
    Win,
    Alt,
    Shift,
    /// Any non-modifier key, by Windows virtual-key code.
    Vk(u16),
}

impl Key {
    pub fn is_modifier(&self) -> bool {
        !matches!(self, Key::Vk(_))
    }
}

pub const VK_ESCAPE: u16 = 0x1B;

/// Map a raw Windows virtual-key code to a `Key` (left/right modifiers collapse).
pub fn key_from_vk(vk: u16) -> Key {
    match vk {
        0x10 | 0xA0 | 0xA1 => Key::Shift,
        0x11 | 0xA2 | 0xA3 => Key::Ctrl,
        0x12 | 0xA4 | 0xA5 => Key::Alt,
        0x5B | 0x5C => Key::Win,
        other => Key::Vk(other),
    }
}

/// Named non-alphanumeric keys (name, vk). The first name per vk is canonical.
const NAMED: &[(&str, u16)] = &[
    ("Space", 0x20),
    ("Esc", 0x1B),
    ("Tab", 0x09),
    ("Enter", 0x0D),
    ("Backspace", 0x08),
    ("Delete", 0x2E),
    ("Insert", 0x2D),
    ("Home", 0x24),
    ("End", 0x23),
    ("PageUp", 0x21),
    ("PageDown", 0x22),
    ("Left", 0x25),
    ("Up", 0x26),
    ("Right", 0x27),
    ("Down", 0x28),
    ("Semicolon", 0xBA),
    ("Equals", 0xBB),
    ("Comma", 0xBC),
    ("Minus", 0xBD),
    ("Period", 0xBE),
    ("Slash", 0xBF),
    ("Backquote", 0xC0),
    ("LeftBracket", 0xDB),
    ("Backslash", 0xDC),
    ("RightBracket", 0xDD),
    ("Quote", 0xDE),
    // Aliases (parse only)
    ("Escape", 0x1B),
    ("Return", 0x0D),
    ("Del", 0x2E),
    ("Ins", 0x2D),
    ("PgUp", 0x21),
    ("PgDn", 0x22),
    ("Plus", 0xBB),
];

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ChordError {
    #[error("empty chord")]
    Empty,
    #[error("empty key name in chord \"{0}\"")]
    EmptyPart(String),
    #[error("unknown key \"{0}\"")]
    UnknownKey(String),
    #[error("a chord can have at most one non-modifier key")]
    MultipleKeys,
}

fn parse_key(name: &str) -> Result<Key, ChordError> {
    let lower = name.to_ascii_lowercase();
    match lower.as_str() {
        "ctrl" | "control" => return Ok(Key::Ctrl),
        "win" | "super" | "meta" | "windows" => return Ok(Key::Win),
        "alt" | "option" => return Ok(Key::Alt),
        "shift" => return Ok(Key::Shift),
        _ => {}
    }
    let bytes = lower.as_bytes();
    if bytes.len() == 1 {
        let c = bytes[0];
        if c.is_ascii_lowercase() {
            return Ok(Key::Vk(c.to_ascii_uppercase() as u16));
        }
        if c.is_ascii_digit() {
            return Ok(Key::Vk(c as u16));
        }
    }
    if let Some(n) = lower.strip_prefix('f') {
        if let Ok(n) = n.parse::<u16>() {
            if (1..=24).contains(&n) {
                return Ok(Key::Vk(0x6F + n));
            }
        }
    }
    if let Some((_, vk)) = NAMED.iter().find(|(n, _)| n.eq_ignore_ascii_case(name)) {
        return Ok(Key::Vk(*vk));
    }
    if let Some(hex) = lower.strip_prefix("vk") {
        if let Ok(vk) = u16::from_str_radix(hex, 16) {
            if vk != 0 && vk <= 0xFF {
                return Ok(key_from_vk(vk));
            }
        }
    }
    Err(ChordError::UnknownKey(name.to_string()))
}

impl fmt::Display for Key {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match *self {
            Key::Ctrl => f.write_str("Ctrl"),
            Key::Win => f.write_str("Win"),
            Key::Alt => f.write_str("Alt"),
            Key::Shift => f.write_str("Shift"),
            Key::Vk(vk @ 0x41..=0x5A) | Key::Vk(vk @ 0x30..=0x39) => {
                write!(f, "{}", vk as u8 as char)
            }
            Key::Vk(vk @ 0x70..=0x87) => write!(f, "F{}", vk - 0x6F),
            Key::Vk(vk) => match NAMED.iter().find(|(_, v)| *v == vk) {
                Some((name, _)) => f.write_str(name),
                None => write!(f, "VK{vk:02X}"),
            },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Chord(BTreeSet<Key>);

impl Chord {
    pub fn parse(s: &str) -> Result<Chord, ChordError> {
        s.parse()
    }

    pub fn from_keys(keys: impl IntoIterator<Item = Key>) -> Result<Chord, ChordError> {
        let set: BTreeSet<Key> = keys.into_iter().collect();
        if set.is_empty() {
            return Err(ChordError::Empty);
        }
        if set.iter().filter(|k| !k.is_modifier()).count() > 1 {
            return Err(ChordError::MultipleKeys);
        }
        Ok(Chord(set))
    }

    pub fn keys(&self) -> &BTreeSet<Key> {
        &self.0
    }

    pub fn contains(&self, key: &Key) -> bool {
        self.0.contains(key)
    }

    pub fn is_modifier_only(&self) -> bool {
        self.0.iter().all(Key::is_modifier)
    }
}

impl FromStr for Chord {
    type Err = ChordError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        if s.trim().is_empty() {
            return Err(ChordError::Empty);
        }
        let mut keys = Vec::new();
        for part in s.split('+') {
            let part = part.trim();
            if part.is_empty() {
                return Err(ChordError::EmptyPart(s.to_string()));
            }
            keys.push(parse_key(part)?);
        }
        Chord::from_keys(keys)
    }
}

impl fmt::Display for Chord {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for (i, k) in self.0.iter().enumerate() {
            if i > 0 {
                f.write_str("+")?;
            }
            write!(f, "{k}")?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_displays_in_canonical_order() {
        let c = Chord::parse("Shift+Alt+Win+Ctrl").unwrap();
        assert_eq!(c.to_string(), "Ctrl+Win+Alt+Shift");
        assert!(c.is_modifier_only());
        assert_eq!(
            Chord::parse("space+win+ctrl").unwrap().to_string(),
            "Ctrl+Win+Space"
        );
    }

    #[test]
    fn round_trips_all_default_shortcuts() {
        for s in [
            "Ctrl+Win",
            "Ctrl+Win+Space",
            "Ctrl+Win+Shift",
            "Ctrl+Win+Alt",
            "Esc",
            "Alt+Shift+Z",
            "Alt+Shift+C",
            "Alt+Shift+1",
            "Alt+Shift+2",
            "Alt+Shift+N",
            "F1",
            "Ctrl+F24",
            "Ctrl+Comma",
            "Win+Right",
            "Ctrl+Alt+Delete",
            "Ctrl+Backquote",
        ] {
            let c = Chord::parse(s).unwrap();
            assert_eq!(c.to_string(), s, "round trip {s}");
            assert_eq!(Chord::parse(&c.to_string()).unwrap(), c);
        }
    }

    #[test]
    fn modifier_only_detection() {
        assert!(Chord::parse("Ctrl+Win").unwrap().is_modifier_only());
        assert!(!Chord::parse("Ctrl+Win+Space").unwrap().is_modifier_only());
        assert!(!Chord::parse("Esc").unwrap().is_modifier_only());
    }

    #[test]
    fn key_codes_are_virtual_keys() {
        assert_eq!(
            Chord::parse("A").unwrap().keys().iter().next(),
            Some(&Key::Vk(0x41))
        );
        assert_eq!(
            Chord::parse("1").unwrap().keys().iter().next(),
            Some(&Key::Vk(0x31))
        );
        assert_eq!(
            Chord::parse("F1").unwrap().keys().iter().next(),
            Some(&Key::Vk(0x70))
        );
        assert_eq!(
            Chord::parse("F12").unwrap().keys().iter().next(),
            Some(&Key::Vk(0x7B))
        );
        assert_eq!(
            Chord::parse("Escape").unwrap(),
            Chord::parse("Esc").unwrap()
        );
    }

    #[test]
    fn rejects_invalid_chords() {
        assert!(matches!(
            Chord::parse("Ctrl+"),
            Err(ChordError::EmptyPart(_))
        ));
        assert!(matches!(
            Chord::parse("+Ctrl"),
            Err(ChordError::EmptyPart(_))
        ));
        assert!(matches!(
            Chord::parse("Foo"),
            Err(ChordError::UnknownKey(_))
        ));
        assert!(matches!(
            Chord::parse("Ctrl+Foo"),
            Err(ChordError::UnknownKey(_))
        ));
        assert!(matches!(Chord::parse(""), Err(ChordError::Empty)));
        assert!(matches!(Chord::parse("A+B"), Err(ChordError::MultipleKeys)));
        assert!(Chord::parse("F25").is_err());
    }

    #[test]
    fn left_right_modifiers_collapse() {
        for vk in [0xA0, 0xA1, 0x10] {
            assert_eq!(key_from_vk(vk), Key::Shift);
        }
        for vk in [0xA2, 0xA3, 0x11] {
            assert_eq!(key_from_vk(vk), Key::Ctrl);
        }
        for vk in [0xA4, 0xA5, 0x12] {
            assert_eq!(key_from_vk(vk), Key::Alt);
        }
        for vk in [0x5B, 0x5C] {
            assert_eq!(key_from_vk(vk), Key::Win);
        }
        assert_eq!(key_from_vk(0x41), Key::Vk(0x41));
    }

    #[test]
    fn unnamed_vk_round_trips_via_hex() {
        let c = Chord::from_keys([Key::Ctrl, Key::Vk(0xE2)]).unwrap();
        assert_eq!(c.to_string(), "Ctrl+VKE2");
        assert_eq!(Chord::parse("Ctrl+VKE2").unwrap(), c);
    }
}
