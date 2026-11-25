//! Microphone capture. A dedicated thread owns the (possibly `!Send`) cpal stream;
//! `Recorder` talks to it over a channel and shares sample state behind a mutex,
//! so `Recorder` itself is `Send + Sync`.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, SizedSample};

use super::dsp;

const PREROLL_MS: usize = 300;
const LEVEL_TICK: Duration = Duration::from_millis(33);
const LEVEL_WINDOW_MS: usize = 60;
const LEVEL_BARS: usize = 12;

type LevelSink = Box<dyn Fn(Vec<f32>) + Send>;

/// Sample state shared between the cpal callback, the owner thread and `Recorder`.
struct Shared {
    /// Device-rate mono samples; last `PREROLL_MS` kept while not recording.
    ring: VecDeque<f32>,
    /// Device-rate mono samples of the active recording.
    rec: Vec<f32>,
    recording: bool,
    sample_rate: u32,
}

struct Inner {
    shared: Mutex<Shared>,
    /// True while a healthy stream is open.
    alive: AtomicBool,
    sink: Mutex<Option<LevelSink>>,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

enum Cmd {
    /// (Re)open the stream; reply with the result.
    Open(Sender<Result<()>>),
    Close(Sender<()>),
    Shutdown,
}

pub struct Recorder {
    inner: Arc<Inner>,
    tx: Mutex<Sender<Cmd>>,
    thread: Mutex<Option<JoinHandle<()>>>,
    keep_warm: bool,
}

impl Recorder {
    /// `device`: input device name (falls back to the default if missing).
    /// With `keep_warm` the stream opens now and stays open (300 ms pre-roll).
    pub fn new(device: Option<String>, keep_warm: bool) -> Result<Self> {
        let inner = Arc::new(Inner {
            shared: Mutex::new(Shared {
                ring: VecDeque::new(),
                rec: Vec::new(),
                recording: false,
                sample_rate: dsp::TARGET_HZ,
            }),
            alive: AtomicBool::new(false),
            sink: Mutex::new(None),
        });
        let (tx, rx) = mpsc::channel::<Cmd>();
        let worker_inner = inner.clone();
        let handle = std::thread::Builder::new()
            .name("utter-audio".into())
            .spawn(move || worker(worker_inner, device, rx))
            .context("spawn audio thread")?;
        let rec = Recorder {
            inner,
            tx: Mutex::new(tx),
            thread: Mutex::new(Some(handle)),
            keep_warm,
        };
        // Validate the device up front (and warm the stream if requested).
        rec.open_stream()?;
        if !keep_warm {
            rec.close_stream();
        }
        Ok(rec)
    }

    fn open_stream(&self) -> Result<()> {
        let (rtx, rrx) = mpsc::channel();
        lock(&self.tx)
            .send(Cmd::Open(rtx))
            .map_err(|_| anyhow!("audio thread stopped"))?;
        rrx.recv().map_err(|_| anyhow!("audio thread stopped"))?
    }

    fn close_stream(&self) {
        let (ctx, crx) = mpsc::channel();
        if lock(&self.tx).send(Cmd::Close(ctx)).is_ok() {
            let _ = crx.recv();
        }
    }

    /// Begin recording. Includes up to 300 ms of pre-roll when warm.
    /// Failures to open the device are logged; `stop` then returns empty audio.
    pub fn start(&self) {
        if !self.inner.alive.load(Ordering::SeqCst) {
            if let Err(e) = self.open_stream() {
                log::error!("audio: cannot open input stream: {e:#}");
            }
        }
        let mut sh = lock(&self.inner.shared);
        let pre: Vec<f32> = sh.ring.drain(..).collect();
        sh.rec = pre;
        sh.recording = true;
    }

    /// Stop and return 16 kHz mono samples.
    pub fn stop(&self) -> Vec<f32> {
        let (samples, rate) = {
            let mut sh = lock(&self.inner.shared);
            sh.recording = false;
            (std::mem::take(&mut sh.rec), sh.sample_rate)
        };
        if !self.keep_warm {
            self.close_stream();
        }
        dsp::resample_to_16k(&samples, rate)
    }

    /// Called ~30x/s with 12 level bars (0..1) while recording.
    pub fn set_level_sink(&self, f: Box<dyn Fn(Vec<f32>) + Send>) {
        *lock(&self.inner.sink) = Some(f);
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

fn worker(inner: Arc<Inner>, device: Option<String>, rx: mpsc::Receiver<Cmd>) {
    // The stream lives only on this thread.
    let mut stream: Option<cpal::Stream> = None;
    loop {
        match rx.recv_timeout(LEVEL_TICK) {
            Ok(Cmd::Open(reply)) => {
                stream = None;
                inner.alive.store(false, Ordering::SeqCst);
                match build_stream(&inner, &device) {
                    Ok(s) => {
                        stream = Some(s);
                        inner.alive.store(true, Ordering::SeqCst);
                        let _ = reply.send(Ok(()));
                    }
                    Err(e) => {
                        let _ = reply.send(Err(e));
                    }
                }
            }
            Ok(Cmd::Close(reply)) => {
                stream = None;
                inner.alive.store(false, Ordering::SeqCst);
                lock(&inner.shared).ring.clear();
                let _ = reply.send(());
            }
            Ok(Cmd::Shutdown) | Err(RecvTimeoutError::Disconnected) => break,
            Err(RecvTimeoutError::Timeout) => {
                let window = {
                    let sh = lock(&inner.shared);
                    if !sh.recording || sh.rec.is_empty() {
                        None
                    } else {
                        let n = (sh.sample_rate as usize * LEVEL_WINDOW_MS / 1000).max(1);
                        let start = sh.rec.len().saturating_sub(n);
                        Some(sh.rec[start..].to_vec())
                    }
                };
                if let Some(w) = window {
                    if let Some(sink) = lock(&inner.sink).as_ref() {
                        sink(dsp::level_bars(&w, LEVEL_BARS));
                    }
                }
            }
        }
    }
    drop(stream);
}

fn build_stream(inner: &Arc<Inner>, device: &Option<String>) -> Result<cpal::Stream> {
    let dev = find_device(device).ok_or_else(|| anyhow!("no input device available"))?;
    let supported = dev.default_input_config().context("default input config")?;
    let rate: u32 = supported.sample_rate() as u32;
    let channels: u16 = supported.channels() as u16;
    let format = supported.sample_format();
    let cfg: cpal::StreamConfig = supported.into();
    {
        let mut sh = lock(&inner.shared);
        sh.sample_rate = rate;
        sh.ring.clear();
    }
    let stream = match format {
        SampleFormat::F32 => build_typed::<f32>(&dev, cfg, inner, channels, rate)?,
        SampleFormat::I16 => build_typed::<i16>(&dev, cfg, inner, channels, rate)?,
        SampleFormat::I32 => build_typed::<i32>(&dev, cfg, inner, channels, rate)?,
        SampleFormat::U16 => build_typed::<u16>(&dev, cfg, inner, channels, rate)?,
        other => return Err(anyhow!("unsupported sample format {other}")),
    };
    stream.play().context("start input stream")?;
    Ok(stream)
}

fn build_typed<T>(
    dev: &cpal::Device,
    cfg: cpal::StreamConfig,
    inner: &Arc<Inner>,
    channels: u16,
    rate: u32,
) -> Result<cpal::Stream>
where
    T: SizedSample + Send + 'static,
    f32: cpal::FromSample<T>,
{
    let data_inner = inner.clone();
    let err_inner = inner.clone();
    let preroll = rate as usize * PREROLL_MS / 1000;
    let stream = dev.build_input_stream(
        cfg,
        move |data: &[T], _| {
            let f: Vec<f32> = data.iter().map(|s| s.to_sample::<f32>()).collect();
            let mono = dsp::to_mono(&f, channels);
            let mut sh = lock(&data_inner.shared);
            if sh.recording {
                sh.rec.extend_from_slice(&mono);
            } else {
                sh.ring.extend(mono);
                let over = sh.ring.len().saturating_sub(preroll);
                if over > 0 {
                    sh.ring.drain(..over);
                }
            }
        },
        move |e| {
            // Device unplugged etc.: keep what we have; next start() reopens.
            log::error!("audio: stream error: {e}");
            err_inner.alive.store(false, Ordering::SeqCst);
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
    fn list_devices_does_not_panic() {
        let _ = list_input_devices();
    }

    #[test]
    #[ignore = "needs a microphone"]
    fn records_one_second_from_default_mic() {
        let rec = Recorder::new(None, false).expect("open mic");
        rec.start();
        std::thread::sleep(Duration::from_secs(1));
        let out = rec.stop();
        assert!(!out.is_empty());
        assert!(out.len() > 8_000, "got {} samples", out.len());
    }
}
