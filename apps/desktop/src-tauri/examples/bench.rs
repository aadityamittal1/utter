//! Benchmark: cargo run --release --example bench -- <model.bin> <wav>
use std::time::Instant;

use utter_lib::stt::engine::{SttOptions, WhisperEngine};

fn read_wav(path: &str) -> Vec<f32> {
    let mut r = hound::WavReader::open(path).expect("open wav");
    let spec = r.spec();
    assert_eq!((spec.sample_rate, spec.channels), (16_000, 1), "need 16 kHz mono");
    r.samples::<i16>().map(|s| s.unwrap() as f32 / 32768.0).collect()
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 {
        eprintln!("usage: bench <model.bin> <wav>");
        std::process::exit(2);
    }
    let samples = read_wav(&args[2]);
    let t = Instant::now();
    let engine = WhisperEngine::load(std::path::Path::new(&args[1])).expect("load model");
    let load_ms = t.elapsed().as_millis();
    let opts = SttOptions { language: Some("en".into()), ..Default::default() };
    let t = Instant::now();
    let text = engine.transcribe(&samples, &opts).expect("transcribe");
    let tr_ms = t.elapsed().as_millis();
    println!("audio_s: {:.1}", samples.len() as f32 / 16_000.0);
    println!("load_ms: {load_ms}");
    println!("transcribe_ms: {tr_ms}");
    println!("text: {text}");
}
