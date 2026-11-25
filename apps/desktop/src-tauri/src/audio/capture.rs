//! Microphone capture. A dedicated thread owns the (possibly `!Send`) cpal stream
//! and all sample state. The realtime callback only converts to mono and sends a
//! small chunk over a channel; the worker thread downsamples incrementally to
//! 16 kHz, so only 16 kHz samples are stored while recording. `Recorder` talks to
//! the worker over a channel and is `Send + Sync`.

use std::collections::VecDeque;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, SizedSample};

use super::dsp;

const PREROLL_MS: usize = 300;
const LEVEL_TICK: Duration = Duration::from_millis(33);
const LEVEL_WINDOW_SAMPLES: usize = 960; // 60 ms at 16 kHz
const LEVEL_BARS: usize = 12;

type LevelSink = Box<dyn Fn(Vec<f32>) + Send>;

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Pure sample-handling state (no device): idle pre-roll ring + live 16 kHz recording.
struct Engine {
    rate: u32,
    ring: VecDeque<f32>,
    rec: Option<dsp::StreamResampler>,
}

impl Engine {
    fn new(rate: u32) -> Self {
        Self {
            rate,
            ring: VecDeque::new(),
            rec: None,
        }
    }

    fn set_rate(&mut self, rate: u32) {
        self.rate = rate;
        self.ring.clear();
    }

    fn recording(&self) -> bool {
        self.rec.is_some()
    }

    /// Device-rate mono chunk.
    fn on_chunk(&mut self, mono: &[f32]) {
        if let Some(r) = self.rec.as_mut() {
            r.push(mono);
        } else {
            self.ring.extend(mono.iter().copied());
            let cap = self.rate as usize * PREROLL_MS / 1000;
            let over = self.ring.len().saturating_sub(cap);
            if over > 0 {
                self.ring.drain(..over);
            }
        }
    }

    /// Returns false (and keeps recording untouched) if already recording.
    fn start(&mut self) -> bool {
        if self.rec.is_some() {
            return false;
        }
        let mut r = dsp::StreamResampler::new(self.rate);
        let pre: Vec<f32> = self.ring.drain(..).collect();
        r.push(&pre);
        self.rec = Some(r);
        true
    }

    fn stop(&mut self) -> Vec<f32> {
        self.rec.take().map(|r| r.finish()).unwrap_or_default()
    }

    fn level_window(&self) -> Option<&[f32]> {
        let out = self.rec.as_ref()?.output();
        if out.is_empty() {
            return None;
        }
        Some(&out[out.len().saturating_sub(LEVEL_WINDOW_SAMPLES)..])
    }
}

enum Cmd {
    /// Device-rate mono samples from the stream with this generation.
    Chunk(u64, Vec<f32>),
    StreamError(u64),
    Open(Sender<Result<()>>),
    Close(Sender<()>),
    Start(Sender<Result<()>>),
    Stop(Sender<Vec<f32>>),
    Sink(LevelSink),
    Shutdown,
}

pub struct Recorder {
    tx: Mutex<Sender<Cmd>>,
    thread: Mutex<Option<JoinHandle<()>>>,
}

impl Recorder {
    /// `device`: input device name (falls back to the default if missing).
    /// With `keep_warm` the stream opens now and stays open (300 ms pre-roll).
    pub fn new(device: Option<String>, keep_warm: bool) -> Result<Self> {
        let (tx, rx) = mpsc::channel::<Cmd>();
        let worker_tx = tx.clone();
        let handle = std::thread::Builder::new()
            .name("utter-audio".into())
            .spawn(move || worker(device, keep_warm, rx, worker_tx))
            .context("spawn audio thread")?;
        let rec = Recorder {
            tx: Mutex::new(tx),
            thread: Mutex::new(Some(handle)),
        };
        // Validate the device up front (and warm the stream if requested).
        rec.request(Cmd::Open)??;
        if !keep_warm {
            rec.request(Cmd::Close)?;
        }
        Ok(rec)
    }

    fn request<R>(&self, make: impl FnOnce(Sender<R>) -> Cmd) -> Result<R> {
        let (rtx, rrx) = mpsc::channel();
        lock(&self.tx)
            .send(make(rtx))
            .map_err(|_| anyhow!("audio thread stopped"))?;
        rrx.recv().map_err(|_| anyhow!("audio thread stopped"))
    }

    /// Begin recording (includes up to 300 ms pre-roll when warm). Err if the
    /// microphone cannot be opened. Calling while already recording is a no-op.
    pub fn start(&self) -> Result<()> {
        self.request(Cmd::Start)?
    }

    /// Stop and return 16 kHz mono samples (empty if not recording).
    pub fn stop(&self) -> Vec<f32> {
        self.request(Cmd::Stop).unwrap_or_default()
    }

    /// Called ~30x/s with 12 level bars (0..1) while recording.
    pub fn set_level_sink(&self, f: Box<dyn Fn(Vec<f32>) + Send>) {
        let _ = lock(&self.tx).send(Cmd::Sink(f));
    }
}

impl Drop for Recorder {
    fn drop(&mut self) {
        let _ = lock(&self.tx).send(Cmd::Shutdown);
        if let Some(h) = lock(&self.thread).take() {
            let _ = h.join();
        }
    }
}

/// Names of available input devices.
pub fn list_input_devices() -> Vec<String> {
    let host = cpal::default_host();
    match host.input_devices() {
        Ok(devs) => devs
            .filter_map(|d| d.description().ok().map(|desc| desc.name().to_string()))
            .collect(),
        Err(e) => {
            log::warn!("audio: cannot list input devices: {e}");
            Vec::new()
        }
    }
}

fn find_device(name: &Option<String>) -> Option<cpal::Device> {
    let host = cpal::default_host();
    if let Some(want) = name {
        if let Ok(devs) = host.input_devices() {
            for d in devs {
                if d.description().map(|x| x.name() == want).unwrap_or(false) {
                    return Some(d);
                }
            }
        }
        log::warn!("audio: device {want:?} not found, using default");
    }
    host.default_input_device()
}

struct Worker {
    device: Option<String>,
    keep_warm: bool,
    tx: Sender<Cmd>,
    engine: Engine,
    stream: Option<cpal::Stream>,
    alive: bool,
    generation: u64,
    sink: Option<LevelSink>,
}

impl Worker {
    fn open(&mut self) -> Result<()> {
        self.stream = None;
        self.alive = false;
        self.generation += 1;
        let (stream, rate) = build_stream(&self.device, self.generation, &self.tx)?;
        self.engine.set_rate(rate);
        self.stream = Some(stream);
        self.alive = true;
        Ok(())
    }

    fn close(&mut self) {
        self.stream = None;
        self.alive = false;
        self.generation += 1;
        self.engine.ring.clear();
    }

    fn emit_levels(&self) {
        if let (Some(sink), Some(w)) = (self.sink.as_ref(), self.engine.level_window()) {
            let bars = dsp::level_bars(w, LEVEL_BARS);
            // A panicking sink must not kill the audio thread.
            let _ = catch_unwind(AssertUnwindSafe(|| sink(bars)));
        }
    }

    fn handle(&mut self, cmd: Cmd) -> bool {
        match cmd {
            Cmd::Chunk(g, mono) => {
                if g == self.generation {
                    self.engine.on_chunk(&mono);
                }
            }
            Cmd::StreamError(g) => {
                if g == self.generation {
                    self.alive = false;
                }
            }
            Cmd::Open(r) => {
                let _ = r.send(self.open());
            }
            Cmd::Close(r) => {
                self.close();
                let _ = r.send(());
            }
            Cmd::Start(r) => {
                let res = if self.engine.recording() {
                    Ok(())
                } else {
                    let opened = if self.alive { Ok(()) } else { self.open() };
                    opened.map(|_| {
                        self.engine.start();
                    })
                };
                let _ = r.send(res);
            }
            Cmd::Stop(r) => {
                let out = self.engine.stop();
                if !self.keep_warm {
                    self.close();
                }
                let _ = r.send(out);
            }
            Cmd::Sink(s) => self.sink = Some(s),
            Cmd::Shutdown => return false,
        }
        true
    }
}

fn worker(device: Option<String>, keep_warm: bool, rx: Receiver<Cmd>, tx: Sender<Cmd>) {
    let mut w = Worker {
        device,
        keep_warm,
        tx,
        engine: Engine::new(dsp::TARGET_HZ),
        stream: None,
        alive: false,
        generation: 0,
        sink: None,
    };
    let mut last_emit = Instant::now();
    loop {
        // Block indefinitely unless recording (then wake for level ticks).
        let cmd = if w.engine.recording() {
            match rx.recv_timeout(LEVEL_TICK) {
                Ok(c) => Some(c),
                Err(RecvTimeoutError::Timeout) => None,
                Err(RecvTimeoutError::Disconnected) => break,
            }
        } else {
            match rx.recv() {
                Ok(c) => Some(c),
                Err(_) => break,
            }
        };
        if let Some(c) = cmd {
            if !w.handle(c) {
                break;
            }
        }
        if w.engine.recording() && last_emit.elapsed() >= LEVEL_TICK {
            last_emit = Instant::now();
            w.emit_levels();
        }
    }
}

fn build_stream(
    device: &Option<String>,
    generation: u64,
    tx: &Sender<Cmd>,
) -> Result<(cpal::Stream, u32)> {
    let dev = find_device(device).ok_or_else(|| anyhow!("no input device available"))?;
    let supported = dev.default_input_config().context("default input config")?;
    let rate: u32 = supported.sample_rate();
    let channels: u16 = supported.channels();
    let format = supported.sample_format();
    let cfg: cpal::StreamConfig = supported.into();
    let stream = match format {
        SampleFormat::F32 => build_typed::<f32>(&dev, cfg, generation, tx, channels)?,
        SampleFormat::I16 => build_typed::<i16>(&dev, cfg, generation, tx, channels)?,
        SampleFormat::I32 => build_typed::<i32>(&dev, cfg, generation, tx, channels)?,
        SampleFormat::U16 => build_typed::<u16>(&dev, cfg, generation, tx, channels)?,
        other => return Err(anyhow!("unsupported sample format {other}")),
    };
    stream.play().context("start input stream")?;
    Ok((stream, rate))
}

/// Stream errors that do not stop the stream: buffer under/overruns, route changes, refused
/// realtime priority. Device-lost errors are not transient.
fn is_transient(kind: cpal::ErrorKind, text: &str) -> bool {
    use cpal::ErrorKind;
    if matches!(
        kind,
        ErrorKind::Xrun | ErrorKind::DeviceChanged | ErrorKind::RealtimeDenied
    ) {
        return true;
    }
    if matches!(
        kind,
        ErrorKind::DeviceNotAvailable | ErrorKind::StreamInvalidated
    ) {
        return false;
    }
    let t = text.to_ascii_lowercase();
    t.contains("underrun") || t.contains("overrun")
}

fn build_typed<T>(
    dev: &cpal::Device,
    cfg: cpal::StreamConfig,
    generation: u64,
    tx: &Sender<Cmd>,
    channels: u16,
) -> Result<cpal::Stream>
where
    T: SizedSample + Send + 'static,
    f32: cpal::FromSample<T>,
{
    let data_tx = tx.clone();
    let err_tx = tx.clone();
    let stream = dev.build_input_stream(
        cfg,
        move |data: &[T], _| {
            // Realtime callback: convert and hand off a small chunk; nothing else.
            let f: Vec<f32> = data.iter().map(|s| s.to_sample::<f32>()).collect();
            let _ = data_tx.send(Cmd::Chunk(generation, dsp::to_mono(&f, channels)));
        },
        move |e| {
            log::warn!("audio: stream error: {e}");
            // Xruns and route changes leave the stream running (chunks keep flowing). Anything
            // else (device unplugged etc.): keep what we have; next start() reopens.
            if !is_transient(e.kind(), &e.to_string()) {
                let _ = err_tx.send(Cmd::StreamError(generation));
            }
        },
        None,
    )?;
    Ok(stream)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recorder_is_send_sync() {
        fn assert<T: Send + Sync>() {}
        assert::<Recorder>();
    }

    #[test]
    fn xruns_are_transient_device_loss_is_not() {
        use cpal::ErrorKind;
        assert!(is_transient(ErrorKind::Xrun, "x"));
        assert!(is_transient(
            ErrorKind::BackendError,
            "Buffer Underrun happened"
        ));
        assert!(is_transient(ErrorKind::Other, "overrun"));
        assert!(!is_transient(ErrorKind::DeviceNotAvailable, "gone"));
        assert!(!is_transient(ErrorKind::DeviceNotAvailable, "underrun"));
        assert!(!is_transient(ErrorKind::BackendError, "something else"));
    }

    #[test]
    fn list_devices_does_not_panic() {
        let _ = list_input_devices();
    }

    #[test]
    fn engine_preroll_is_capped_and_seeds_recording() {
        let mut e = Engine::new(16_000);
        e.on_chunk(&vec![0.1; 16_000]); // 1 s idle
        assert_eq!(e.ring.len(), 4_800); // 300 ms
        assert!(e.start());
        e.on_chunk(&vec![0.2; 1_600]);
        assert_eq!(e.stop().len(), 4_800 + 1_600);
        assert!(e.ring.is_empty());
    }

    #[test]
    fn engine_double_start_keeps_recording() {
        let mut e = Engine::new(16_000);
        assert!(e.start());
        e.on_chunk(&vec![0.2; 1_000]);
        assert!(!e.start());
        e.on_chunk(&vec![0.2; 1_000]);
        assert_eq!(e.stop().len(), 2_000);
        assert!(e.stop().is_empty());
    }

    #[test]
    fn engine_downsamples_incrementally_at_48k() {
        let mut e = Engine::new(48_000);
        e.start();
        for _ in 0..100 {
            e.on_chunk(&vec![0.3; 480]); // 1 s in 10 ms chunks
        }
        let out = e.stop();
        assert!((out.len() as i64 - 16_000).abs() <= 20, "len {}", out.len());
    }

    #[test]
    #[ignore = "needs a microphone"]
    fn records_one_second_from_default_mic() {
        let rec = Recorder::new(None, false).expect("open mic");
        rec.start().expect("start");
        std::thread::sleep(Duration::from_secs(1));
        let out = rec.stop();
        assert!(out.len() > 8_000, "got {} samples", out.len());
    }

    #[test]
    #[ignore = "needs a microphone"]
    fn warm_recorder_levels_and_double_start() {
        let rec = Recorder::new(None, true).expect("open mic");
        let n = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let n2 = n.clone();
        rec.set_level_sink(Box::new(move |b| {
            assert_eq!(b.len(), 12);
            n2.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            panic!("sink panics must not kill the audio thread");
        }));
        rec.start().unwrap();
        rec.start().unwrap();
        std::thread::sleep(Duration::from_secs(1));
        let out = rec.stop();
        assert!(out.len() > 12_000, "got {}", out.len());
        assert!(n.load(std::sync::atomic::Ordering::SeqCst) > 5);
    }
}
