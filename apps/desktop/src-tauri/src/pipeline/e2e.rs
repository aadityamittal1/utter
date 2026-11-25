//! Manual end-to-end test: `tests/fixtures/ten_seconds.wav` -> Whisper -> text stage ->
//! paste into a Notepad window this test launches. Run explicitly:
//!
//! `cargo test --lib wav_to_notepad -- --ignored --nocapture`
//!
//! Needs a downloaded Whisper model (`UTTER_TEST_MODEL` = path, else the app's default model in
//! `%APPDATA%\dev.utter.app\models`). Set `UTTER_TEST_API_KEY` to also exercise the Claude route.
//!
//! Safety: refuses to run if any Notepad window already exists, uses a temp file, checks the
//! window title before pasting, and only kills the Notepad process it started.

use super::process::{is_silent_audio, run_text_stage, transcribe, TextInput, TextOutcome};
use super::route::Mode;
use crate::audio::wav::read_wav_16k;
use crate::context::foreground_windows::focus_window;
use crate::insert::{capture_selection, insert_text, ClipboardSnapshot, PasteMethod};
use crate::settings::Settings;
use crate::stt::catalog;
use crate::stt::engine::WhisperEngine;
use crate::text::types::Category;
use ::windows::core::{BOOL, PWSTR};
use ::windows::Win32::Foundation::{HWND, LPARAM};
use ::windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, TerminateProcess, PROCESS_NAME_FORMAT,
    PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE,
};
use ::windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VIRTUAL_KEY,
};
use ::windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible,
};
use std::path::{Path, PathBuf};
use std::time::Duration;

fn exe_name(pid: u32) -> Option<String> {
    // SAFETY: buffer sized per API contract.
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 520];
        let mut len = buf.len() as u32;
        QueryFullProcessImageNameW(h, PROCESS_NAME_FORMAT(0), PWSTR(buf.as_mut_ptr()), &mut len)
            .ok()?;
        let s = String::from_utf16_lossy(&buf[..len as usize]);
        Some(s.rsplit('\\').next()?.to_ascii_lowercase())
    }
}

struct Found(Vec<(isize, u32)>);

unsafe extern "system" fn enum_cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let found = &mut *(lparam.0 as *mut Found);
    if IsWindowVisible(hwnd).as_bool() {
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if exe_name(pid).as_deref() == Some("notepad.exe") {
            found.0.push((hwnd.0 as isize, pid));
        }
    }
    BOOL(1)
}

fn find_notepads() -> Vec<(isize, u32)> {
    let mut found = Found(Vec::new());
    // SAFETY: the callback only dereferences the `Found` passed for the duration of the call.
    unsafe {
        let _ = EnumWindows(Some(enum_cb), LPARAM(&mut found as *mut Found as isize));
    }
    found.0
}

fn window_title(hwnd: isize) -> String {
    let mut buf = [0u16; 512];
    // SAFETY: buffer is valid for its length.
    let n = unsafe { GetWindowTextW(HWND(hwnd as *mut _), &mut buf) };
    String::from_utf16_lossy(&buf[..n.max(0) as usize])
}

/// Ctrl+A in the foreground window (only called after the title check).
fn select_all() {
    let key = |vk: u16, up: bool| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VIRTUAL_KEY(vk),
                dwFlags: if up { KEYEVENTF_KEYUP } else { Default::default() },
                ..Default::default()
            },
        },
    };
    let inputs = [key(0x11, false), key(0x41, false), key(0x41, true), key(0x11, true)];
    // SAFETY: well-formed INPUT array.
    unsafe {
        SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
    }
}

/// Kills only the Notepad we started, deletes the temp file, restores the clipboard.
struct Cleanup {
    pid: Option<u32>,
    child: std::process::Child,
    tmp: PathBuf,
    clipboard: Option<ClipboardSnapshot>,
}

impl Drop for Cleanup {
    fn drop(&mut self) {
        if let Some(pid) = self.pid {
            // SAFETY: terminating the Notepad process we launched and verified.
            unsafe {
                if let Ok(h) = OpenProcess(PROCESS_TERMINATE, false, pid) {
                    let _ = TerminateProcess(h, 0);
                }
            }
        }
        let _ = self.child.kill();
        std::thread::sleep(Duration::from_millis(200));
        let _ = std::fs::remove_file(&self.tmp);
        if let Some(c) = &self.clipboard {
            c.restore();
        }
    }
}

fn model_path() -> PathBuf {
    if let Ok(p) = std::env::var("UTTER_TEST_MODEL") {
        return PathBuf::from(p);
    }
    let appdata = std::env::var("APPDATA").expect("APPDATA");
    catalog::model_path(
        &Path::new(&appdata).join("dev.utter.app").join("models"),
        catalog::default_model_id(),
    )
}

fn has_word(text: &str, word: &str) -> bool {
    text.split(|c: char| !c.is_alphanumeric())
        .any(|w| w.eq_ignore_ascii_case(word))
}

#[test]
#[ignore = "launches Notepad and drives the real keyboard/clipboard; needs a Whisper model"]
fn wav_to_notepad() {
    assert!(
        find_notepads().is_empty(),
        "close all Notepad windows before running this test"
    );

    // 1. Audio -> text through the same functions the session worker uses.
    let wav = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/ten_seconds.wav");
    let samples = read_wav_16k(&wav).expect("read fixture");
    assert!(!is_silent_audio(&samples));
    let model = model_path();
    assert!(model.exists(), "no Whisper model at {} (set UTTER_TEST_MODEL)", model.display());
    let engine = WhisperEngine::load(&model).expect("load model");
    let settings = Settings::default();
    let raw = transcribe(&engine, &samples, &settings, &[]).expect("transcribe");
    println!("whisper: {} chars", raw.len());

    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("runtime");
    let run = |key: Option<&str>| -> String {
        let input = TextInput {
            raw: &raw,
            silent: false,
            mode: Mode::Dictate,
            settings: &settings,
            category: Category::Other,
            app_name: "Notepad",
            dict: &[],
            snippets: &[],
            selection: None,
            api_key: key,
            base_url: None,
        };
        match rt.block_on(run_text_stage(&input)) {
            TextOutcome::Text(r) => r.text,
            other => panic!("expected text, got {other:?}"),
        }
    };
    let local = run(None);
    let claude = std::env::var("UTTER_TEST_API_KEY").ok().map(|k| run(Some(&k)));

    // 2. Launch our own Notepad on a temp file.
    let clipboard = ClipboardSnapshot::take();
    let name = "utter_pipeline_e2e";
    // Unique per run: Notepad restores unsaved tabs by path and shows a modal "Keep unsaved
    // changes?" dialog that swallows all injected keys if a previous run left one behind.
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos());
    let unique = format!("{name}_{stamp}");
    let tmp = std::env::temp_dir().join(format!("{unique}.txt"));
    std::fs::write(&tmp, "").expect("temp file");
    let child = std::process::Command::new("notepad.exe")
        .arg(&tmp)
        .spawn()
        .expect("spawn notepad");
    let mut guard = Cleanup { pid: None, child, tmp, clipboard };

    // Adopt ONLY a window whose title carries this run's unique file name; a Notepad the user
    // opens while we launch must never be adopted (and later killed by the Drop guard).
    let mut ours: Vec<(isize, u32)> = Vec::new();
    for _ in 0..50 {
        std::thread::sleep(Duration::from_millis(200));
        ours = find_notepads()
            .into_iter()
            .filter(|(h, _)| window_title(*h).contains(&unique))
            .collect();
        if !ours.is_empty() {
            break;
        }
    }
    assert_eq!(ours.len(), 1, "expected exactly one of our Notepad windows, got {ours:?}");
    let (hwnd, pid) = ours[0];
    guard.pid = Some(pid);
    std::thread::sleep(Duration::from_millis(800));

    // 3. Paste each result, verifying the window is ours before every keystroke.
    let check = |text: &str, label: &str| {
        // A freshly launched background process may be denied foreground at first; retry.
        let focused = (0..6).any(|_| {
            let ok = focus_window(hwnd);
            if !ok {
                std::thread::sleep(Duration::from_millis(300));
            }
            ok
        });
        assert!(focused, "could not focus test Notepad");
        assert!(
            window_title(hwnd).contains(&unique),
            "window is not our temp document: {:?}",
            window_title(hwnd)
        );
        select_all();
        std::thread::sleep(Duration::from_millis(100));
        insert_text(text, PasteMethod::CtrlV, Some(hwnd)).expect("insert");
        std::thread::sleep(Duration::from_millis(600));
        assert!(
            focus_window(hwnd) && window_title(hwnd).contains(&unique),
            "lost focus / wrong document before capture"
        );
        select_all();
        std::thread::sleep(Duration::from_millis(100));
        let got = capture_selection(PasteMethod::CtrlV).unwrap_or_default();
        println!("{label}: {} chars in Notepad", got.len());
        assert!(has_word(&got, "Thursday"), "{label}: missing Thursday");
        assert!(!has_word(&got, "um"), "{label}: filler 'um' survived");
    };
    check(&local, "local");
    if let Some(c) = claude {
        check(&c, "claude");
    }
}
