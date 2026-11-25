//! Local speech-to-text via whisper.cpp (whisper-rs). Audio never leaves the machine.

use std::path::Path;

use anyhow::{anyhow, Context, Result};
use whisper_rs::{
    FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters,
};

#[derive(Debug, Clone, Default)]
pub struct SttOptions {
    /// ISO 639-1 code, or `None` to auto-detect.
    pub language: Option<String>,
    /// Translate the speech to English.
    pub translate: bool,
    /// Vocabulary hint (dictionary words) fed to the decoder.
    pub initial_prompt: String,
}

pub struct WhisperEngine {
    ctx: WhisperContext,
}

/// Inference threads. Defaults to min(cores, 4): on a 10-core Snapdragon X under x64
/// emulation, 6+ threads made whisper.cpp 50x+ slower (spin-wait contention), while 4
/// was fastest. `UTTER_THREADS` overrides this for benchmarking.
fn thread_count() -> i32 {
    if let Some(n) = std::env::var("UTTER_THREADS").ok().and_then(|v| v.parse::<i32>().ok()) {
        return n.max(1);
    }
    std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(4) as i32
}

impl WhisperEngine {
    pub fn load(path: &Path) -> Result<Self> {
        let mut params = WhisperContextParameters::default();
        params.use_gpu(false);
        let ctx = WhisperContext::new_with_params(path, params)
            .map_err(|e| anyhow!("failed to load whisper model {}: {e}", path.display()))?;
        Ok(Self { ctx })
    }

    /// Transcribes 16 kHz mono f32 samples. Returns the trimmed text (possibly empty).
    pub fn transcribe(&self, samples_16k_mono: &[f32], opts: &SttOptions) -> Result<String> {
        let mut state = self.ctx.create_state().context("create whisper state")?;
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_n_threads(thread_count());
        params.set_language(Some(opts.language.as_deref().unwrap_or("auto")));
        params.set_translate(opts.translate);
        params.set_no_context(true);
        params.set_single_segment(false);
        params.set_suppress_blank(true);
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        if !opts.initial_prompt.trim().is_empty() {
            params.set_initial_prompt(&opts.initial_prompt);
        }
        state.full(params, samples_16k_mono).context("whisper inference")?;

        let mut out = String::new();
        for i in 0..state.full_n_segments() {
            if let Some(seg) = state.get_segment(i) {
                out.push_str(&seg.to_str_lossy().context("segment text")?);
            }
        }
        Ok(out.trim().to_string())
    }
}
