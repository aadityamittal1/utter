//! Pure audio DSP helpers: downmix, resample, level metering, gain, silence detection.

use rubato::audioadapter_buffers::direct::InterleavedSlice;
use rubato::{Async, FixedAsync, Resampler, SincInterpolationParameters, WindowFunction};

pub const TARGET_HZ: u32 = 16_000;

/// Average interleaved frames down to one channel.
pub fn to_mono(interleaved: &[f32], channels: u16) -> Vec<f32> {
    let ch = channels.max(1) as usize;
    if ch == 1 {
        return interleaved.to_vec();
    }
    interleaved
        .chunks_exact(ch)
        .map(|f| f.iter().sum::<f32>() / ch as f32)
        .collect()
}

/// Resample mono audio to 16 kHz with a sinc resampler (passthrough at 16 kHz).
/// Falls back to linear interpolation if the sinc resampler fails.
pub fn resample_to_16k(mono: &[f32], from_hz: u32) -> Vec<f32> {
    if from_hz == TARGET_HZ || mono.is_empty() || from_hz == 0 {
        return mono.to_vec();
    }
    match resample_sinc(mono, from_hz) {
        Some(v) => v,
        None => resample_linear(mono, from_hz),
    }
}

fn resample_sinc(mono: &[f32], from_hz: u32) -> Option<Vec<f32>> {
    let ratio = TARGET_HZ as f64 / from_hz as f64;
    let params = SincInterpolationParameters::new(128, WindowFunction::BlackmanHarris2);
    let mut rs = Async::<f32>::new_sinc(ratio, 1.0, &params, 1024, 1, FixedAsync::Input).ok()?;
    let input = InterleavedSlice::new(mono, 1, mono.len()).ok()?;
    let out = rs.process_all(&input, mono.len(), None).ok()?;
    Some(out.take_data())
}

fn resample_linear(mono: &[f32], from_hz: u32) -> Vec<f32> {
    let ratio = from_hz as f64 / TARGET_HZ as f64;
    let n = (mono.len() as f64 / ratio) as usize;
    (0..n)
        .map(|i| {
            let pos = i as f64 * ratio;
            let i0 = pos as usize;
            let frac = (pos - i0 as f64) as f32;
            let a = mono[i0.min(mono.len() - 1)];
            let b = mono[(i0 + 1).min(mono.len() - 1)];
            a + (b - a) * frac
        })
        .collect()
}

/// Root mean square (0.0 for empty input).
pub fn rms(s: &[f32]) -> f32 {
    if s.is_empty() {
        return 0.0;
    }
    (s.iter().map(|x| x * x).sum::<f32>() / s.len() as f32).sqrt()
}

/// Scale so the peak sits at 0.89 (-1 dBFS), at most x20. No-op for near-silence.
pub fn normalize_gain(s: &mut [f32]) {
    let peak = s.iter().fold(0.0f32, |m, x| m.max(x.abs()));
    if peak < 1e-4 {
        return;
    }
    let gain = (0.89 / peak).min(20.0);
    for x in s.iter_mut() {
        *x *= gain;
    }
}

/// `n` RMS chunks of `window`, mapped from -60..-10 dBFS onto 0..1.
pub fn level_bars(window: &[f32], n: usize) -> Vec<f32> {
    (0..n)
        .map(|i| {
            if window.is_empty() {
                return 0.0;
            }
            let a = i * window.len() / n;
            let b = ((i + 1) * window.len() / n).max(a + 1).min(window.len());
            let r = rms(&window[a.min(b - 1)..b]);
            if r <= 0.0 {
                return 0.0;
            }
            let db = 20.0 * r.log10();
            ((db + 60.0) / 50.0).clamp(0.0, 1.0)
        })
        .collect()
}

/// True when no 30 ms frame (16 kHz) of the signal has RMS above 0.01.
pub fn is_silent(s: &[f32]) -> bool {
    const FRAME: usize = 480;
    if s.is_empty() {
        return true;
    }
    !s.chunks(FRAME).any(|f| rms(f) > 0.01)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f32::consts::PI;

    fn sine(hz: f32, rate: u32, secs: f32, amp: f32) -> Vec<f32> {
        (0..(rate as f32 * secs) as usize)
            .map(|i| amp * (2.0 * PI * hz * i as f32 / rate as f32).sin())
            .collect()
    }

    #[test]
    fn resample_48k_to_16k_length() {
        let out = resample_to_16k(&sine(440.0, 48_000, 1.0, 0.5), 48_000);
        assert!((out.len() as i64 - 16_000).abs() <= 20, "len {}", out.len());
        // tone survives: energy roughly preserved
        assert!(rms(&out[2000..14000]) > 0.3);
    }

    #[test]
    fn resample_44k1_to_16k_length() {
        let out = resample_to_16k(&sine(440.0, 44_100, 1.0, 0.5), 44_100);
        assert!((out.len() as i64 - 16_000).abs() <= 20, "len {}", out.len());
    }

    #[test]
    fn resample_passthrough_at_16k() {
        let x = sine(300.0, 16_000, 0.1, 0.5);
        assert_eq!(resample_to_16k(&x, 16_000), x);
    }

    #[test]
    fn stereo_to_mono_averages() {
        assert_eq!(
            to_mono(&[1.0, 0.0, 0.5, 0.5, -1.0, 1.0], 2),
            vec![0.5, 0.5, 0.0]
        );
        assert_eq!(to_mono(&[0.1, 0.2], 1), vec![0.1, 0.2]);
    }

    #[test]
    fn rms_of_square_wave_is_one() {
        let sq: Vec<f32> = (0..1000)
            .map(|i| if i % 2 == 0 { 1.0 } else { -1.0 })
            .collect();
        assert!((rms(&sq) - 1.0).abs() < 1e-6);
        assert_eq!(rms(&[]), 0.0);
    }

    #[test]
    fn normalize_gain_reaches_target_peak() {
        let mut x = sine(200.0, 16_000, 0.1, 0.1);
        normalize_gain(&mut x);
        let peak = x.iter().fold(0.0f32, |m, v| m.max(v.abs()));
        assert!((peak - 0.89).abs() < 1e-3, "peak {peak}");
    }

    #[test]
    fn normalize_gain_caps_at_20x() {
        let mut x = vec![0.005f32, -0.005];
        normalize_gain(&mut x);
        assert!((x[0] - 0.1).abs() < 1e-6);
    }

    #[test]
    fn normalize_gain_noop_on_near_silence() {
        let mut x = vec![5e-5f32, -5e-5];
        normalize_gain(&mut x);
        assert_eq!(x, vec![5e-5, -5e-5]);
    }

    #[test]
    fn level_bars_maps_db_range() {
        let loud = vec![0.5f32; 1200]; // ~ -6 dBFS -> clamps to 1
        assert!(level_bars(&loud, 12)
            .iter()
            .all(|&b| (b - 1.0).abs() < 1e-6));
        let quiet = vec![0.0001f32; 1200]; // -80 dBFS -> 0
        assert!(level_bars(&quiet, 12).iter().all(|&b| b == 0.0));
        let mid = vec![0.01f32; 1200]; // -40 dBFS -> 0.4
        let b = level_bars(&mid, 12);
        assert_eq!(b.len(), 12);
        assert!((b[3] - 0.4).abs() < 0.01);
        assert_eq!(level_bars(&[], 12), vec![0.0; 12]);
    }

    #[test]
    fn silence_detection() {
        assert!(is_silent(&vec![0.0; 16_000]));
        assert!(is_silent(&[]));
        // -70 dBFS noise
        let noise: Vec<f32> = (0..16_000)
            .map(|i| if i % 2 == 0 { 3.2e-4 } else { -3.2e-4 })
            .collect();
        assert!(is_silent(&noise));
        assert!(!is_silent(&sine(300.0, 16_000, 0.5, 0.3)));
    }

    #[test]
    fn hello_fixture_is_not_silent_and_silence_fixture_is() {
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/");
        let hello =
            crate::audio::wav::read_wav_16k(std::path::Path::new(&format!("{dir}hello.wav")))
                .unwrap();
        assert!(!is_silent(&hello));
        let sil =
            crate::audio::wav::read_wav_16k(std::path::Path::new(&format!("{dir}silence.wav")))
                .unwrap();
        assert!(is_silent(&sil));
    }
}
