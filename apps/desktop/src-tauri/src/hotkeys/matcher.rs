//! Pure hotkey matcher: raw key events in, per-binding events out.
//! No clocks inside; callers pass `t_ms` (any monotonic millisecond counter).

use super::action::Action;
use super::chord::{Chord, Key};
use std::collections::BTreeSet;

/// Window after an activation in which a growing/changing held set re-targets or cancels it.
pub const CHANGE_WINDOW_MS: u64 = 300;
/// Max gap between the first release and second press of Dictate for a double tap.
pub const DOUBLE_TAP_MS: u64 = 400;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Trigger {
    Hold,
    Toggle,
    Press,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Binding {
    pub action: Action,
    pub chord: Chord,
    pub trigger: Trigger,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HotkeyEvent {
    Pressed(Action),
    Released(Action),
    Cancelled(Action),
    DoubleTap(Action),
}

/// The default shortcut set (Windows). Transform ids are `polish` and `prompt`.
pub fn default_bindings() -> Vec<Binding> {
    let b = |action: Action, chord: &str, trigger: Trigger| Binding {
        action,
        // Invariant: literals below are valid chords (covered by tests).
        chord: Chord::parse(chord).expect("valid default chord"),
        trigger,
    };
    vec![
        b(Action::Dictate, "Ctrl+Win", Trigger::Hold),
        b(Action::HandsFree, "Ctrl+Win+Space", Trigger::Toggle),
        b(Action::DictateEnhance, "Ctrl+Win+Shift", Trigger::Hold),
        b(Action::Command, "Ctrl+Win+Alt", Trigger::Hold),
        b(Action::Cancel, "Esc", Trigger::Press),
        b(Action::PasteLast, "Alt+Shift+Z", Trigger::Press),
        b(Action::CopyLast, "Alt+Shift+C", Trigger::Press),
        b(
            Action::Transform("polish".into()),
            "Alt+Shift+1",
            Trigger::Press,
        ),
        b(
            Action::Transform("prompt".into()),
            "Alt+Shift+2",
            Trigger::Press,
        ),
        b(Action::QuickNote, "Alt+Shift+N", Trigger::Press),
    ]
}

#[derive(Debug, Clone)]
struct Active {
    idx: usize,
    t_ms: u64,
    /// Set for the second press of a double tap: its release emits nothing.
    suppress_release: bool,
}

/// See [Matcher::watch_state].
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct WatchState {
    pub chord_down: bool,
    pub chord_seen: bool,
    pub stale_held: bool,
}

#[derive(Debug)]
pub struct Matcher {
    bindings: Vec<Binding>,
    /// Key sets of the bound modifier-only chords (cached for the hook watchdog).
    modifier_chords: Vec<Vec<Key>>,
    held: BTreeSet<Key>,
    active: Option<Active>,
    /// After a cancel/release with keys still down, nothing re-arms until all keys are up.
    dirty: bool,
    recording: bool,
    last_dictate_release: Option<u64>,
    /// Non-modifier keys whose down/up the hook must swallow.
    swallowed: BTreeSet<Key>,
    swallow_up: Option<Key>,
    mask_pending: bool,
    /// A chord containing Win/Alt fired during the current hold (cleared when all keys are up).
    fired_mask: bool,
    /// The event just processed is a Win/Alt key-up that needs a mask key first.
    mask_up: bool,
}

impl Matcher {
    pub fn new(bindings: Vec<Binding>) -> Self {
        let modifier_chords = bindings
            .iter()
            .filter(|b| b.chord.is_modifier_only() && !b.chord.keys().is_empty())
            .map(|b| b.chord.keys().iter().copied().collect())
            .collect();
        Matcher {
            bindings,
            modifier_chords,
            held: BTreeSet::new(),
            active: None,
            dirty: false,
            recording: false,
            last_dictate_release: None,
            swallowed: BTreeSet::new(),
            swallow_up: None,
            mask_pending: false,
            fired_mask: false,
            mask_up: false,
        }
    }

    /// Watchdog snapshot (no allocation): is a bound modifier-only chord physically down
    /// (`is_down`), does this matcher already hold all its keys (so the hook saw the press), and
    /// does it hold any key that is physically up (a missed key-up).
    pub fn watch_state(&self, is_down: impl Fn(Key) -> bool) -> WatchState {
        let mut s = WatchState::default();
        for c in &self.modifier_chords {
            if c.iter().all(|&k| is_down(k)) {
                s.chord_down = true;
                if c.iter().all(|k| self.held.contains(k)) {
                    s.chord_seen = true;
                }
            }
        }
        // Keys our hook swallows never reach the async key state: they look up while held.
        s.stale_held = self
            .held
            .iter()
            .any(|k| !self.swallowed.contains(k) && !is_down(*k));
        s
    }

    /// Watchdog resync after a missed key-up: like prune, but swallowed keys count as down,
    /// and the release is not remembered for double-tap detection.
    pub fn resync(&mut self, is_down: impl Fn(Key) -> bool, t_ms: u64) -> Vec<HotkeyEvent> {
        let swallowed = self.swallowed.clone();
        let ev = self.prune(|k| swallowed.contains(&k) || is_down(k), t_ms);
        self.last_dictate_release = None;
        ev
    }

    /// Replace bindings (settings changed). Drops all in-flight state.
    pub fn set_bindings(&mut self, bindings: Vec<Binding>) {
        let recording = self.recording;
        *self = Matcher::new(bindings);
        self.recording = recording;
    }

    /// Forget held keys (e.g. after a missed key-up such as Win+L). Returns `Cancelled` for an
    /// in-flight hold binding so the consumer can abort cleanly.
    pub fn reset(&mut self) -> Vec<HotkeyEvent> {
        let ev = match &self.active {
            Some(a) if self.is_hold(a) => {
                vec![HotkeyEvent::Cancelled(self.bindings[a.idx].action.clone())]
            }
            _ => Vec::new(),
        };
        let (bindings, recording) = (std::mem::take(&mut self.bindings), self.recording);
        *self = Matcher::new(bindings);
        self.recording = recording;
        ev
    }

    /// Self-heal stale held keys: any held key that `is_down` reports as up is released
    /// (emitting `Released` for an active hold binding). Call before processing a key-down,
    /// with the key being processed reported as down.
    pub fn prune(&mut self, is_down: impl Fn(Key) -> bool, t_ms: u64) -> Vec<HotkeyEvent> {
        let stale: Vec<Key> = self.held.iter().copied().filter(|k| !is_down(*k)).collect();
        let mut ev = Vec::new();
        for k in stale {
            ev.extend(self.on_key(k, false, t_ms));
        }
        ev
    }

    /// True when the event just processed is a Win/Alt key-up that follows a fired Win/Alt chord:
    /// the hook should inject the mask key right before letting that key-up through.
    pub fn mask_before_up(&self) -> bool {
        self.mask_up
    }

    /// While on, `Cancel` bindings (Esc) are live and swallowed.
    pub fn set_recording(&mut self, on: bool) {
        self.recording = on;
    }

    /// True once after an activation of a chord containing Win or Alt: the hook should inject
    /// the mask key so releasing that modifier does not open Start / the app menu bar.
    pub fn take_mask_request(&mut self) -> bool {
        std::mem::take(&mut self.mask_pending)
    }

    /// Whether the hook should swallow this event. Call right after `on_key` for the same event.
    pub fn should_swallow(&self, key: Key, down: bool) -> bool {
        if key.is_modifier() {
            return false;
        }
        if down {
            self.swallowed.contains(&key)
        } else {
            self.swallow_up == Some(key)
        }
    }

    pub fn on_key(&mut self, key: Key, down: bool, t_ms: u64) -> Vec<HotkeyEvent> {
        self.mask_pending = false;
        self.swallow_up = None;
        self.mask_up = false;
        let mut ev = Vec::new();
        if down {
            if !self.held.insert(key) {
                return ev; // rule 7: auto-repeat
            }
            self.handle_down(t_ms, &mut ev);
        } else {
            if !self.held.remove(&key) {
                return ev;
            }
            if self.swallowed.remove(&key) {
                self.swallow_up = Some(key);
            }
            self.mask_up = self.fired_mask && matches!(key, Key::Win | Key::Alt);
            self.handle_up(key, t_ms, &mut ev);
        }
        ev
    }

    /// While a Dictate hold is active, completing the HandsFree chord (any time) locks the
    /// recording: `Pressed(HandsFree)` without cancelling Dictate, and Dictate's release is
    /// then silent. Returns true if handled.
    fn try_lock_hands_free(&mut self, ev: &mut Vec<HotkeyEvent>) -> bool {
        let (Some(a), Some(idx)) = (self.active.clone(), self.find_binding()) else {
            return false;
        };
        if self.bindings[idx].action != Action::HandsFree
            || self.bindings[a.idx].action != Action::Dictate
        {
            return false;
        }
        let chord = self.bindings[idx].chord.clone();
        ev.push(HotkeyEvent::Pressed(Action::HandsFree));
        if let Some(act) = self.active.as_mut() {
            act.suppress_release = true;
        }
        self.note_fired(&chord);
        true
    }

    fn note_fired(&mut self, chord: &Chord) {
        if chord.contains(&Key::Win) || chord.contains(&Key::Alt) {
            self.mask_pending = true;
            self.fired_mask = true;
        }
        for k in chord.keys().iter().filter(|k| !k.is_modifier()) {
            self.swallowed.insert(*k);
        }
    }

    fn find_binding(&self) -> Option<usize> {
        self.bindings.iter().position(|b| {
            b.chord.keys() == &self.held && (b.action != Action::Cancel || self.recording)
        })
    }

    fn is_hold(&self, a: &Active) -> bool {
        self.bindings[a.idx].trigger == Trigger::Hold && !a.suppress_release
    }

    fn handle_down(&mut self, t_ms: u64, ev: &mut Vec<HotkeyEvent>) {
        match self.active.clone() {
            Some(a) => {
                if self.try_lock_hands_free(ev) {
                    return;
                }
                if t_ms.saturating_sub(a.t_ms) > CHANGE_WINDOW_MS {
                    return; // extra keys after the window are ignored
                }
                let next = self.find_binding();
                if self.is_hold(&a) {
                    ev.push(HotkeyEvent::Cancelled(self.bindings[a.idx].action.clone()));
                }
                match next {
                    Some(idx) => self.activate(idx, t_ms, ev),
                    None => {
                        self.active = None;
                        self.dirty = true;
                    }
                }
            }
            None => {
                if !self.dirty {
                    if let Some(idx) = self.find_binding() {
                        self.activate(idx, t_ms, ev);
                    }
                }
            }
        }
    }

    fn activate(&mut self, idx: usize, t_ms: u64, ev: &mut Vec<HotkeyEvent>) {
        let b = self.bindings[idx].clone();
        let mut suppress_release = false;
        let is_dictate_hold = b.action == Action::Dictate && b.trigger == Trigger::Hold;
        let double = is_dictate_hold
            && self
                .last_dictate_release
                .is_some_and(|r| t_ms.saturating_sub(r) <= DOUBLE_TAP_MS);
        if double {
            self.last_dictate_release = None;
            suppress_release = true;
            ev.push(HotkeyEvent::DoubleTap(b.action.clone()));
        } else {
            ev.push(HotkeyEvent::Pressed(b.action.clone()));
        }
        self.active = Some(Active {
            idx,
            t_ms,
            suppress_release,
        });
        self.note_fired(&b.chord);
    }

    fn handle_up(&mut self, key: Key, t_ms: u64, ev: &mut Vec<HotkeyEvent>) {
        if let Some(a) = self.active.clone() {
            if self.bindings[a.idx].chord.contains(&key) {
                let b = &self.bindings[a.idx];
                if self.is_hold(&a) {
                    ev.push(HotkeyEvent::Released(b.action.clone()));
                    if b.action == Action::Dictate {
                        self.last_dictate_release = Some(t_ms);
                    }
                }
                self.active = None;
                self.dirty = true;
            }
        }
        if self.held.is_empty() {
            self.dirty = false;
            self.fired_mask = false;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hotkeys::chord::VK_ESCAPE;
    use HotkeyEvent::*;

    const CTRL: Key = Key::Ctrl;
    const WIN: Key = Key::Win;
    const ALT: Key = Key::Alt;
    const SHIFT: Key = Key::Shift;
    const SPACE: Key = Key::Vk(0x20);
    const RIGHT: Key = Key::Vk(0x27);
    const ESC: Key = Key::Vk(VK_ESCAPE);
    const Z: Key = Key::Vk(0x5A);

    fn m() -> Matcher {
        Matcher::new(default_bindings())
    }

    fn dn(m: &mut Matcher, k: Key, t: u64) -> Vec<HotkeyEvent> {
        m.on_key(k, true, t)
    }
    fn up(m: &mut Matcher, k: Key, t: u64) -> Vec<HotkeyEvent> {
        m.on_key(k, false, t)
    }

    #[test]
    fn default_bindings_are_valid_and_distinct() {
        let b = default_bindings();
        assert_eq!(b.len(), 10);
        let chords: BTreeSet<_> = b.iter().map(|b| b.chord.clone()).collect();
        assert_eq!(chords.len(), b.len());
    }

    // Rule 1
    #[test]
    fn activates_when_held_equals_chord() {
        let mut m = m();
        assert!(dn(&mut m, CTRL, 0).is_empty());
        assert_eq!(dn(&mut m, WIN, 10), vec![Pressed(Action::Dictate)]);
    }

    #[test]
    fn order_of_pressing_does_not_matter() {
        let mut m = m();
        assert!(dn(&mut m, WIN, 0).is_empty());
        assert_eq!(dn(&mut m, CTRL, 10), vec![Pressed(Action::Dictate)]);
    }

    // Rule 2
    #[test]
    fn growing_into_another_binding_cancels_then_presses() {
        let mut m = m();
        dn(&mut m, CTRL, 0);
        dn(&mut m, WIN, 10);
        assert_eq!(
            dn(&mut m, SHIFT, 120),
            vec![Cancelled(Action::Dictate), Pressed(Action::DictateEnhance)]
        );
        assert_eq!(
            up(&mut m, SHIFT, 900),
            vec![Released(Action::DictateEnhance)]
        );
        // Ctrl+Win remaining must not re-arm Dictate.
        assert!(up(&mut m, WIN, 950).is_empty());
        assert!(up(&mut m, CTRL, 960).is_empty());
    }

    #[test]
    fn command_chord_via_alt() {
        let mut m = m();
        dn(&mut m, CTRL, 0);
        dn(&mut m, WIN, 10);
        assert_eq!(
            dn(&mut m, ALT, 50),
            vec![Cancelled(Action::Dictate), Pressed(Action::Command)]
        );
        assert_eq!(up(&mut m, WIN, 700), vec![Released(Action::Command)]);
    }

    // Rule 2 + 6: toggle emits only Pressed
    #[test]
    fn hands_free_toggle_only_presses() {
        let mut m = m();
        dn(&mut m, CTRL, 0);
        dn(&mut m, WIN, 10);
        // Locks the current recording: no Cancelled(Dictate).
        assert_eq!(dn(&mut m, SPACE, 100), vec![Pressed(Action::HandsFree)]);
        assert!(m.should_swallow(SPACE, true));
        assert!(up(&mut m, SPACE, 160).is_empty());
        assert!(m.should_swallow(SPACE, false));
        // Dictate's release is silent once locked.
        assert!(up(&mut m, WIN, 170).is_empty());
        assert!(up(&mut m, CTRL, 180).is_empty());
        // Fully released: Dictate works again, and is not a double tap.
        dn(&mut m, CTRL, 1000);
        assert_eq!(dn(&mut m, WIN, 1010), vec![Pressed(Action::Dictate)]);
    }

    #[test]
    fn hands_free_lock_works_after_change_window() {
        let mut m = m();
        dn(&mut m, CTRL, 0);
        dn(&mut m, WIN, 10);
        assert_eq!(dn(&mut m, SPACE, 5000), vec![Pressed(Action::HandsFree)]);
        assert!(m.should_swallow(SPACE, true));
        assert!(m.take_mask_request());
        assert!(up(&mut m, SPACE, 5100).is_empty());
        assert!(up(&mut m, WIN, 5200).is_empty());
        assert!(up(&mut m, CTRL, 5210).is_empty());
    }

    #[test]
    fn hands_free_chord_without_dictate_active_still_presses() {
        let mut m = m();
        dn(&mut m, WIN, 0);
        dn(&mut m, SPACE, 1);
        assert_eq!(dn(&mut m, CTRL, 2), vec![Pressed(Action::HandsFree)]);
    }

    #[test]
    fn double_tap_boundary_400_fires_401_does_not() {
        for (gap, fires) in [(400u64, true), (401, false)] {
            let mut m = m();
            dn(&mut m, CTRL, 0);
            dn(&mut m, WIN, 10);
            up(&mut m, WIN, 1000);
            up(&mut m, CTRL, 1001);
            dn(&mut m, CTRL, 1000 + gap - 1);
            let ev = dn(&mut m, WIN, 1000 + gap);
            if fires {
                assert_eq!(ev, vec![DoubleTap(Action::Dictate)]);
            } else {
                assert_eq!(ev, vec![Pressed(Action::Dictate)]);
            }
        }
    }

    #[test]
    fn prune_drops_stale_win_so_ctrl_alone_does_not_fire() {
        let mut m = m();
        dn(&mut m, WIN, 0); // Win+L: key-up never seen
        up(&mut m, Key::Vk(0x4C), 1); // unrelated
                                      // Next real key-down is Ctrl; the OS says Win is up.
        let pruned = m.prune(|k| k == CTRL, 5000);
        assert!(pruned.is_empty());
        assert!(dn(&mut m, CTRL, 5000).is_empty());
        assert_eq!(dn(&mut m, WIN, 5010), vec![Pressed(Action::Dictate)]);
    }

    #[test]
    fn prune_releases_active_hold_binding() {
        let mut m = m();
        dn(&mut m, CTRL, 0);
        dn(&mut m, WIN, 10);
        assert_eq!(m.prune(|k| k == CTRL, 900), vec![Released(Action::Dictate)]);
        // Nothing left active; Ctrl alone is still held and must not re-fire.
        assert!(up(&mut m, CTRL, 910).is_empty());
    }

    #[test]
    fn prune_emits_nothing_for_toggle_or_keys_still_down() {
        let mut m = m();
        dn(&mut m, CTRL, 0);
        dn(&mut m, WIN, 10);
        dn(&mut m, Key::Vk(0x20), 4000); // lock (toggle-like)
        assert!(m.prune(|_| true, 4100).is_empty());
        let mut t = Matcher::new(vec![Binding {
            action: Action::HandsFree,
            chord: Chord::parse("Ctrl+Win+Space").unwrap(),
            trigger: Trigger::Toggle,
        }]);
        dn(&mut t, CTRL, 0);
        dn(&mut t, WIN, 1);
        dn(&mut t, SPACE, 2);
        assert!(t.prune(|_| false, 3).is_empty());
    }

    #[test]
    fn reset_cancels_active_hold() {
        let mut m = m();
        dn(&mut m, CTRL, 0);
        dn(&mut m, WIN, 10);
        assert_eq!(m.reset(), vec![Cancelled(Action::Dictate)]);
        assert!(m.reset().is_empty());
    }

    #[test]
    fn mask_before_win_or_alt_key_up_after_chord_fired() {
        let mut m = m();
        dn(&mut m, CTRL, 0);
        dn(&mut m, WIN, 10);
        up(&mut m, WIN, 500);
        assert!(m.mask_before_up());
        up(&mut m, CTRL, 510);
        assert!(!m.mask_before_up()); // Ctrl never needs it
                                      // Next hold with no chord fired (Win alone): no mask.
        dn(&mut m, WIN, 2000);
        up(&mut m, WIN, 2100);
        assert!(!m.mask_before_up());
    }

    #[test]
    fn mask_before_up_for_alt_shortcut() {
        let mut m = m();
        dn(&mut m, ALT, 0);
        dn(&mut m, SHIFT, 1);
        dn(&mut m, Z, 2);
        up(&mut m, Z, 3);
        up(&mut m, ALT, 4);
        assert!(m.mask_before_up());
    }

    #[test]
    fn press_binding_emits_only_pressed() {
        let mut m = m();
        dn(&mut m, ALT, 0);
        dn(&mut m, SHIFT, 5);
        assert_eq!(dn(&mut m, Z, 10), vec![Pressed(Action::PasteLast)]);
        assert!(up(&mut m, Z, 60).is_empty());
        assert!(up(&mut m, SHIFT, 70).is_empty());
        assert!(up(&mut m, ALT, 80).is_empty());
    }

    // Rule 3
    #[test]
    fn extra_key_with_no_binding_cancels_and_stays_cancelled() {
        let mut m = m();
        dn(&mut m, CTRL, 0);
        dn(&mut m, WIN, 10);
        assert_eq!(dn(&mut m, RIGHT, 80), vec![Cancelled(Action::Dictate)]);
        // Releasing the arrow leaves Ctrl+Win held: must not re-fire Dictate.
        assert!(up(&mut m, RIGHT, 120).is_empty());
        assert!(up(&mut m, WIN, 200).is_empty());
        assert!(up(&mut m, CTRL, 210).is_empty());
        // Fully released: works again.
        dn(&mut m, CTRL, 2000);
        assert_eq!(dn(&mut m, WIN, 2010), vec![Pressed(Action::Dictate)]);
    }

    #[test]
    fn extra_keys_after_window_are_ignored() {
        let mut m = m();
        dn(&mut m, CTRL, 0);
        dn(&mut m, WIN, 10);
        assert!(dn(&mut m, RIGHT, 400).is_empty());
        assert!(up(&mut m, RIGHT, 450).is_empty());
        assert_eq!(up(&mut m, WIN, 900), vec![Released(Action::Dictate)]);
    }

    #[test]
    fn window_boundary_is_inclusive_300() {
        let mut m = m();
        dn(&mut m, CTRL, 0);
        dn(&mut m, WIN, 10);
        assert_eq!(dn(&mut m, RIGHT, 310), vec![Cancelled(Action::Dictate)]);
        let mut m2 = self::m();
        dn(&mut m2, CTRL, 0);
        dn(&mut m2, WIN, 10);
        assert!(dn(&mut m2, RIGHT, 311).is_empty());
    }

    // Rule 4
    #[test]
    fn released_when_any_chord_key_goes_up() {
        let mut m = m();
        dn(&mut m, CTRL, 0);
        dn(&mut m, WIN, 10);
        assert_eq!(up(&mut m, WIN, 800), vec![Released(Action::Dictate)]);
        assert!(up(&mut m, CTRL, 810).is_empty());

        let mut m = self::m();
        dn(&mut m, CTRL, 0);
        dn(&mut m, WIN, 10);
        assert_eq!(up(&mut m, CTRL, 800), vec![Released(Action::Dictate)]);
    }

    // Rule 5
    #[test]
    fn double_tap_dictate() {
        let mut m = m();
        dn(&mut m, CTRL, 0);
        assert_eq!(dn(&mut m, WIN, 10), vec![Pressed(Action::Dictate)]);
        assert_eq!(up(&mut m, WIN, 100), vec![Released(Action::Dictate)]);
        up(&mut m, CTRL, 105);
        dn(&mut m, CTRL, 300);
        assert_eq!(dn(&mut m, WIN, 310), vec![DoubleTap(Action::Dictate)]);
        // Release of the second press emits nothing (hands-free keeps going).
        assert!(up(&mut m, WIN, 400).is_empty());
        assert!(up(&mut m, CTRL, 405).is_empty());
        // A third tap right after is a fresh Pressed, not another DoubleTap.
        dn(&mut m, CTRL, 500);
        assert_eq!(dn(&mut m, WIN, 510), vec![Pressed(Action::Dictate)]);
    }

    #[test]
    fn double_tap_gap_measured_from_first_release() {
        let mut m = m();
        dn(&mut m, CTRL, 0);
        dn(&mut m, WIN, 10);
        up(&mut m, WIN, 1000);
        up(&mut m, CTRL, 1001);
        dn(&mut m, CTRL, 1390);
        assert_eq!(dn(&mut m, WIN, 1400), vec![DoubleTap(Action::Dictate)]);
    }

    #[test]
    fn slow_second_press_is_not_a_double_tap() {
        let mut m = m();
        dn(&mut m, CTRL, 0);
        dn(&mut m, WIN, 10);
        up(&mut m, WIN, 100);
        up(&mut m, CTRL, 101);
        dn(&mut m, CTRL, 600);
        assert_eq!(dn(&mut m, WIN, 601), vec![Pressed(Action::Dictate)]);
    }

    #[test]
    fn cancelled_dictate_does_not_count_for_double_tap() {
        let mut m = m();
        dn(&mut m, CTRL, 0);
        dn(&mut m, WIN, 10);
        dn(&mut m, SHIFT, 50); // -> enhance
        up(&mut m, SHIFT, 100);
        up(&mut m, WIN, 110);
        up(&mut m, CTRL, 120);
        dn(&mut m, CTRL, 200);
        assert_eq!(dn(&mut m, WIN, 210), vec![Pressed(Action::Dictate)]);
    }

    // Rule 7
    #[test]
    fn auto_repeat_produces_no_events() {
        let mut m = m();
        dn(&mut m, CTRL, 0);
        assert_eq!(dn(&mut m, WIN, 10).len(), 1);
        for t in [50, 100, 150, 200, 700] {
            assert!(dn(&mut m, WIN, t).is_empty());
            assert!(dn(&mut m, CTRL, t).is_empty());
        }
        assert_eq!(up(&mut m, WIN, 900), vec![Released(Action::Dictate)]);
    }

    #[test]
    fn auto_repeat_while_growing_does_not_cancel() {
        let mut m = m();
        dn(&mut m, CTRL, 0);
        dn(&mut m, WIN, 10);
        assert!(dn(&mut m, WIN, 50).is_empty()); // repeat inside the window
        assert_eq!(up(&mut m, WIN, 100), vec![Released(Action::Dictate)]);
    }

    #[test]
    fn stray_key_up_is_ignored() {
        let mut m = m();
        assert!(up(&mut m, CTRL, 0).is_empty());
    }

    // Esc / recording
    #[test]
    fn esc_cancels_only_while_recording() {
        let mut m = m();
        assert!(dn(&mut m, ESC, 0).is_empty());
        assert!(!m.should_swallow(ESC, true));
        up(&mut m, ESC, 10);
        m.set_recording(true);
        assert_eq!(dn(&mut m, ESC, 100), vec![Pressed(Action::Cancel)]);
        assert!(m.should_swallow(ESC, true));
        assert!(dn(&mut m, ESC, 130).is_empty()); // repeat
        assert!(m.should_swallow(ESC, true));
        up(&mut m, ESC, 200);
        assert!(m.should_swallow(ESC, false));
        m.set_recording(false);
        assert!(dn(&mut m, ESC, 300).is_empty());
        assert!(!m.should_swallow(ESC, true));
    }

    // Swallow
    #[test]
    fn swallows_non_modifier_key_of_matched_chord_down_and_up() {
        let mut m = m();
        dn(&mut m, ALT, 0);
        assert!(!m.should_swallow(ALT, true));
        dn(&mut m, SHIFT, 5);
        dn(&mut m, Z, 10);
        assert!(m.should_swallow(Z, true));
        dn(&mut m, Z, 40);
        assert!(m.should_swallow(Z, true));
        up(&mut m, Z, 60);
        assert!(m.should_swallow(Z, false));
        // Next unrelated event: not swallowed.
        up(&mut m, SHIFT, 70);
        assert!(!m.should_swallow(Z, false));
        assert!(!m.should_swallow(SHIFT, false));
    }

    #[test]
    fn never_swallows_modifier_only_chords_or_unmatched_keys() {
        let mut m = m();
        dn(&mut m, CTRL, 0);
        dn(&mut m, WIN, 10);
        assert!(!m.should_swallow(CTRL, true));
        assert!(!m.should_swallow(WIN, true));
        dn(&mut m, RIGHT, 80); // desktop switch: must pass through
        assert!(!m.should_swallow(RIGHT, true));
        up(&mut m, RIGHT, 90);
        assert!(!m.should_swallow(RIGHT, false));
    }

    #[test]
    fn unmatched_z_with_alt_only_is_not_swallowed() {
        let mut m = m();
        dn(&mut m, ALT, 0);
        dn(&mut m, Z, 10);
        assert!(!m.should_swallow(Z, true));
    }

    // Mask key
    #[test]
    fn mask_requested_for_win_or_alt_chords_once() {
        let mut m = m();
        dn(&mut m, CTRL, 0);
        assert!(!m.take_mask_request());
        dn(&mut m, WIN, 10);
        assert!(m.take_mask_request());
        assert!(!m.take_mask_request());
        // Chained into Enhance: requested again.
        dn(&mut m, SHIFT, 50);
        assert!(m.take_mask_request());
        up(&mut m, SHIFT, 60);
        assert!(!m.take_mask_request());
    }

    #[test]
    fn mask_requested_for_alt_shortcuts_but_not_ctrl_only() {
        let mut m = m();
        dn(&mut m, ALT, 0);
        dn(&mut m, SHIFT, 1);
        dn(&mut m, Z, 2);
        assert!(m.take_mask_request());

        let mut m = Matcher::new(vec![Binding {
            action: Action::QuickNote,
            chord: Chord::parse("Ctrl+Shift+N").unwrap(),
            trigger: Trigger::Press,
        }]);
        dn(&mut m, CTRL, 0);
        dn(&mut m, SHIFT, 1);
        assert_eq!(
            dn(&mut m, Key::Vk(0x4E), 2),
            vec![Pressed(Action::QuickNote)]
        );
        assert!(!m.take_mask_request());
    }

    #[test]
    fn reset_clears_stuck_keys() {
        let mut m = m();
        dn(&mut m, WIN, 0); // Win+L: key-up never arrives
        m.reset();
        dn(&mut m, CTRL, 1000);
        assert_eq!(dn(&mut m, WIN, 1010), vec![Pressed(Action::Dictate)]);
    }

    #[test]
    fn set_bindings_swaps_chords() {
        let mut m = m();
        m.set_bindings(vec![Binding {
            action: Action::Dictate,
            chord: Chord::parse("Ctrl+Alt").unwrap(),
            trigger: Trigger::Hold,
        }]);
        dn(&mut m, CTRL, 0);
        assert_eq!(dn(&mut m, ALT, 5), vec![Pressed(Action::Dictate)]);
    }

    #[test]
    fn watch_state_reports_seen_chord_and_stale_keys() {
        let mut m = m();
        let all_up = |_: Key| false;
        assert_eq!(m.watch_state(all_up), WatchState::default());
        // Chord physically down but the matcher never saw it: hook presumed dead.
        let down = |k: Key| k == CTRL || k == WIN;
        let s = m.watch_state(down);
        assert!(s.chord_down && !s.chord_seen && !s.stale_held);
        // Matcher saw the press: alive.
        dn(&mut m, CTRL, 0);
        dn(&mut m, WIN, 10);
        let s = m.watch_state(down);
        assert!(s.chord_down && s.chord_seen && !s.stale_held);
        // Keys released physically but the matcher still holds them: missed key-up.
        let s = m.watch_state(all_up);
        assert!(!s.chord_down && s.stale_held);
    }

    #[test]
    fn swallowed_held_key_is_not_stale_and_resync_keeps_it() {
        // Dictate bound to Ctrl+Space (hold): Space is swallowed, so GetAsyncKeyState says up.
        let mut m = Matcher::new(vec![Binding {
            action: Action::Dictate,
            chord: Chord::parse("Ctrl+Space").unwrap(),
            trigger: Trigger::Hold,
        }]);
        let space = Key::Vk(0x20);
        dn(&mut m, CTRL, 0);
        dn(&mut m, space, 10);
        let ctrl_only = |k: Key| k == CTRL;
        assert!(m.should_swallow(space, true));
        assert!(!m.watch_state(ctrl_only).stale_held);
        assert!(m.resync(ctrl_only, 900).is_empty());
        // Ctrl physically released while still held in the matcher: stale, and resync releases.
        assert!(m.watch_state(|_| false).stale_held);
        assert_eq!(
            m.resync(|_| false, 1000),
            vec![HotkeyEvent::Released(Action::Dictate)]
        );
    }
}
