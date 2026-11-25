//! Pure recording-session state machine: hotkey/pill input in, one command out.

use super::route::Mode;
use crate::hotkeys::action::Action;
use crate::hotkeys::matcher::HotkeyEvent;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum State {
    Idle,
    Recording { mode: Mode, locked: bool },
}

/// Pill buttons that affect a recording.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PillInput {
    Stop,
    Cancel,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Input {
    Hotkey(HotkeyEvent),
    Pill(PillInput),
    /// The 20 minute limit was reached.
    MaxDuration,
}

/// What the worker must do after a transition.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Cmd {
    Start { mode: Mode, locked: bool },
    /// Switch the running recording to hands-free (visual only).
    Lock,
    /// Stop recording and process the audio.
    Finish,
    /// Stop recording and throw the audio away.
    Discard,
}

fn mode_of(action: &Action) -> Option<Mode> {
    match action {
        Action::Dictate => Some(Mode::Dictate),
        Action::DictateEnhance => Some(Mode::DictateEnhance),
        Action::Command => Some(Mode::Command),
        _ => None,
    }
}

fn action_of(mode: Mode) -> Action {
    match mode {
        Mode::Dictate => Action::Dictate,
        Mode::DictateEnhance => Action::DictateEnhance,
        Mode::Command => Action::Command,
    }
}

/// One transition. Events that do not apply in `state` leave it unchanged.
pub fn step(state: State, input: &Input) -> (State, Option<Cmd>) {
    use HotkeyEvent::*;
    match (state, input) {
        (State::Idle, Input::Hotkey(Pressed(a))) => match (mode_of(a), a) {
            (Some(mode), _) => (
                State::Recording { mode, locked: false },
                Some(Cmd::Start { mode, locked: false }),
            ),
            (None, Action::HandsFree) => start_locked(),
            _ => (state, None),
        },
        (State::Idle, Input::Hotkey(DoubleTap(Action::Dictate))) => start_locked(),
        (State::Recording { mode, locked: false }, Input::Hotkey(ev)) => match ev {
            Released(a) if *a == action_of(mode) => (State::Idle, Some(Cmd::Finish)),
            Cancelled(a) if *a == action_of(mode) => (State::Idle, Some(Cmd::Discard)),
            Pressed(Action::HandsFree) => (
                State::Recording { mode, locked: true },
                Some(Cmd::Lock),
            ),
            Pressed(Action::Cancel) => (State::Idle, Some(Cmd::Discard)),
            _ => (state, None),
        },
        (State::Recording { locked: true, .. }, Input::Hotkey(ev)) => match ev {
            Pressed(Action::Dictate | Action::HandsFree) | DoubleTap(Action::Dictate) => {
                (State::Idle, Some(Cmd::Finish))
            }
            Pressed(Action::Cancel) => (State::Idle, Some(Cmd::Discard)),
            _ => (state, None),
        },
        (State::Recording { .. }, Input::Pill(PillInput::Stop)) => (State::Idle, Some(Cmd::Finish)),
        (State::Recording { .. }, Input::Pill(PillInput::Cancel)) => {
            (State::Idle, Some(Cmd::Discard))
        }
        (State::Recording { .. }, Input::MaxDuration) => (State::Idle, Some(Cmd::Finish)),
        _ => (state, None),
    }
}

fn start_locked() -> (State, Option<Cmd>) {
    (
        State::Recording {
            mode: Mode::Dictate,
            locked: true,
        },
        Some(Cmd::Start {
            mode: Mode::Dictate,
            locked: true,
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use HotkeyEvent::*;

    fn hk(e: HotkeyEvent) -> Input {
        Input::Hotkey(e)
    }

    fn run(events: &[Input]) -> (State, Vec<Cmd>) {
        let mut s = State::Idle;
        let mut cmds = vec![];
        for e in events {
            let (n, c) = step(s, e);
            s = n;
            cmds.extend(c);
        }
        (s, cmds)
    }

    #[test]
    fn hold_to_dictate_starts_then_finishes_on_release() {
        let (s, c) = run(&[hk(Pressed(Action::Dictate)), hk(Released(Action::Dictate))]);
        assert_eq!(s, State::Idle);
        assert_eq!(
            c,
            vec![
                Cmd::Start { mode: Mode::Dictate, locked: false },
                Cmd::Finish
            ]
        );
    }

    #[test]
    fn enhance_and_command_hold_modes() {
        for (a, m) in [
            (Action::DictateEnhance, Mode::DictateEnhance),
            (Action::Command, Mode::Command),
        ] {
            let (s, c) = run(&[hk(Pressed(a.clone())), hk(Released(a))]);
            assert_eq!(s, State::Idle);
            assert_eq!(c, vec![Cmd::Start { mode: m, locked: false }, Cmd::Finish]);
        }
    }

    #[test]
    fn release_of_a_different_action_is_ignored() {
        let (s, c) = run(&[hk(Pressed(Action::Command)), hk(Released(Action::Dictate))]);
        assert_eq!(s, State::Recording { mode: Mode::Command, locked: false });
        assert_eq!(c.len(), 1);
    }

    #[test]
    fn hands_free_while_holding_locks_and_release_is_ignored() {
        let (s, c) = run(&[
            hk(Pressed(Action::Dictate)),
            hk(Pressed(Action::HandsFree)),
            hk(Released(Action::Dictate)),
        ]);
        assert_eq!(s, State::Recording { mode: Mode::Dictate, locked: true });
        assert_eq!(c[1], Cmd::Lock);
        assert_eq!(c.len(), 2);
    }

    #[test]
    fn locked_recording_stops_on_next_dictate_or_hands_free() {
        for stop in [
            hk(Pressed(Action::Dictate)),
            hk(Pressed(Action::HandsFree)),
            hk(DoubleTap(Action::Dictate)),
            Input::Pill(PillInput::Stop),
            Input::MaxDuration,
        ] {
            let (s, c) = run(&[hk(Pressed(Action::HandsFree)), stop]);
            assert_eq!(s, State::Idle);
            assert_eq!(
                c,
                vec![Cmd::Start { mode: Mode::Dictate, locked: true }, Cmd::Finish]
            );
        }
    }

    #[test]
    fn double_tap_starts_a_locked_recording() {
        let (s, c) = run(&[hk(DoubleTap(Action::Dictate))]);
        assert_eq!(s, State::Recording { mode: Mode::Dictate, locked: true });
        assert_eq!(c, vec![Cmd::Start { mode: Mode::Dictate, locked: true }]);
    }

    #[test]
    fn cancel_paths_discard() {
        for cancel in [
            hk(Pressed(Action::Cancel)),
            hk(Cancelled(Action::Dictate)),
            Input::Pill(PillInput::Cancel),
        ] {
            let (s, c) = run(&[hk(Pressed(Action::Dictate)), cancel]);
            assert_eq!(s, State::Idle);
            assert_eq!(c.last(), Some(&Cmd::Discard));
        }
        let (s, c) = run(&[hk(Pressed(Action::HandsFree)), hk(Pressed(Action::Cancel))]);
        assert_eq!((s, c.last().copied()), (State::Idle, Some(Cmd::Discard)));
    }

    #[test]
    fn chord_growth_cancels_then_restarts_in_the_new_mode() {
        let (s, c) = run(&[
            hk(Pressed(Action::Dictate)),
            hk(Cancelled(Action::Dictate)),
            hk(Pressed(Action::DictateEnhance)),
        ]);
        assert_eq!(s, State::Recording { mode: Mode::DictateEnhance, locked: false });
        assert_eq!(c[1], Cmd::Discard);
    }

    #[test]
    fn idle_ignores_stray_events() {
        for e in [
            hk(Released(Action::Dictate)),
            hk(Pressed(Action::Cancel)),
            hk(Cancelled(Action::Dictate)),
            Input::Pill(PillInput::Stop),
            Input::MaxDuration,
            hk(Pressed(Action::PasteLast)),
        ] {
            assert_eq!(step(State::Idle, &e), (State::Idle, None));
        }
    }
}
