//! 16 kHz mono WAV read/write (16-bit PCM on disk).

use std::path::Path;

use anyhow::{Context, Result};

use super::dsp;

/// Write 16 kHz mono samples as 16-bit PCM.
pub fn write_wav_16k(path: &Path, samples: &[f32]) -> Result<()> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: dsp::TARGET_HZ,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut w = hound::WavWriter::create(path, spec)
        .with_context(|| format!("create {}", path.display()))?;
    for &s in samples {
        w.write_sample((s.clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16)?;
    }
    w.finalize()?;
    Ok(())
}

/// Read any int/float WAV, downmixing to mono and resampling to 16 kHz as needed.
pub fn read_wav_16k(path: &Path) -> Result<Vec<f32>> {
    let mut r = hound::WavReader::open(path).with_context(|| format!("open {}", path.display()))?;
    let spec = r.spec();
    let interleaved: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => r.samples::<f32>().collect::<Result<_, _>>()?,
        hound::SampleFormat::Int => {
            let scale = 1.0 / (1u64 << (spec.bits_per_sample.max(1) - 1)) as f32;
            r.samples::<i32>()
                .map(|s| s.map(|v| v as f32 * scale))
                .collect::<Result<_, _>>()?
        }
    };
    let mono = dsp::to_mono(&interleaved, spec.channels);
    Ok(dsp::resample_to_16k(&mono, spec.sample_rate))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_16k() {
        let dir = std::env::temp_dir().join("utter_wav_rt.wav");
        let x: Vec<f32> = (0..1600).map(|i| (i as f32 * 0.05).sin() * 0.5).collect();
        write_wav_16k(&dir, &x).unwrap();
        let y = read_wav_16k(&dir).unwrap();
        std::fs::remove_file(&dir).ok();
        assert_eq!(x.len(), y.len());
        assert!(x.iter().zip(&y).all(|(a, b)| (a - b).abs() < 1e-3));
    }

    #[test]
    fn reads_other_formats_resampled_and_downmixed() {
        let p = std::env::temp_dir().join("utter_wav_48k_stereo.wav");
        let spec = hound::WavSpec {
            channels: 2,
            sample_rate: 48_000,
            bits_per_sample: 32,
            sample_format: hound::SampleFormat::Float,
        };
        let mut w = hound::WavWriter::create(&p, spec).unwrap();
        for i in 0..48_000 {
            let v = (i as f32 * 0.03).sin() * 0.4;
            w.write_sample(v).unwrap();
            w.write_sample(v).unwrap();
        }
        w.finalize().unwrap();
        let y = read_wav_16k(&p).unwrap();
        std::fs::remove_file(&p).ok();
        assert!((y.len() as i64 - 16_000).abs() <= 20, "len {}", y.len());
    }

    #[test]
    fn reads_fixtures() {
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/");
        let ten = read_wav_16k(Path::new(&format!("{dir}ten_seconds.wav"))).unwrap();
        let frames = hound::WavReader::open(format!("{dir}ten_seconds.wav"))
            .unwrap()
            .duration() as usize;
        assert_eq!(ten.len(), frames);
    }
}
