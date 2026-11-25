//! Integration tests for the whisper engine. Ignored by default: they need a
//! downloaded model (`%APPDATA%/dev.utter.app/models/ggml-base.bin`).
use std::path::PathBuf;

use utter_lib::stt::engine::{SttOptions, WhisperEngine};

fn read_wav(name: &str) -> Vec<f32> {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name);
    hound::WavReader::open(p)
        .unwrap()
        .samples::<i16>()
        .map(|s| s.unwrap() as f32 / 32768.0)
        .collect()
}

fn engine() -> WhisperEngine {
    let dir =
        PathBuf::from(std::env::var("APPDATA").expect("APPDATA")).join("dev.utter.app/models");
    WhisperEngine::load(&dir.join("ggml-base.bin")).expect("model present (download base first)")
}

#[test]
#[ignore]
fn transcribes_hello_fixture() {
    let opts = SttOptions {
        language: Some("en".into()),
        ..Default::default()
    };
    let text = engine().transcribe(&read_wav("hello.wav"), &opts).unwrap();
    assert!(text.to_lowercase().contains("hello world"), "got: {text}");
}
