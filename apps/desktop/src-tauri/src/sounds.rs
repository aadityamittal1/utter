//! Start / stop / error sounds (bundled WAVs played from memory, never blocking).

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Sound {
    Start,
    Stop,
    Error,
}

static START: &[u8] = include_bytes!("../resources/sounds/start.wav");
static STOP: &[u8] = include_bytes!("../resources/sounds/stop.wav");
static ERROR: &[u8] = include_bytes!("../resources/sounds/error.wav");

fn bytes(s: Sound) -> &'static [u8] {
    match s {
        Sound::Start => START,
        Sound::Stop => STOP,
        Sound::Error => ERROR,
    }
}

/// Play `sound` asynchronously. A newer sound replaces one still playing.
#[cfg(target_os = "windows")]
pub fn play(sound: Sound) {
    use ::windows::core::PCWSTR;
    use ::windows::Win32::Media::Audio::{PlaySoundW, SND_ASYNC, SND_MEMORY, SND_NODEFAULT};
    let data = bytes(sound);
    // SAFETY: with SND_MEMORY the "name" is a pointer to a WAV image; it is 'static, so it
    // stays valid for the whole asynchronous playback.
    unsafe {
        let _ = PlaySoundW(
            PCWSTR(data.as_ptr().cast()),
            None,
            SND_MEMORY | SND_ASYNC | SND_NODEFAULT,
        );
    }
}

#[cfg(not(target_os = "windows"))]
pub fn play(_sound: Sound) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_sounds_are_riff_wave() {
        for s in [Sound::Start, Sound::Stop, Sound::Error] {
            let b = bytes(s);
            assert!(b.len() > 44, "{s:?}");
            assert_eq!(&b[0..4], b"RIFF", "{s:?}");
            assert_eq!(&b[8..12], b"WAVE", "{s:?}");
        }
    }
}
