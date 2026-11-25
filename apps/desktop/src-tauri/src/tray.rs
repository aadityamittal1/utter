//! System tray icon and menu.

use crate::app_state::AppState;
use crate::hotkeys::action::Action;
use crate::hotkeys::matcher::HotkeyEvent;
use crate::pipeline::session::SessionMsg;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

const TRAY_ID: &str = "main";

static IDLE: &[u8] = include_bytes!("../icons/tray/tray-idle-32.png");
static IDLE_DARK: &[u8] = include_bytes!("../icons/tray/tray-idle-dark-32.png");
static PAUSED: &[u8] = include_bytes!("../icons/tray/tray-paused-32.png");
static PAUSED_DARK: &[u8] = include_bytes!("../icons/tray/tray-paused-dark-32.png");
static RECORDING: &[u8] = include_bytes!("../icons/tray/tray-recording-32.png");

/// Menu item whose label flips between pause and resume.
struct PauseItem(MenuItem<tauri::Wry>);

/// True when the Windows taskbar uses the light theme (dark glyphs needed).
#[cfg(target_os = "windows")]
fn taskbar_is_light() -> bool {
    use ::windows::core::w;
    use ::windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};
    let mut data = 0u32;
    let mut len = std::mem::size_of::<u32>() as u32;
    // SAFETY: out-pointers reference live locals of the stated size.
    let rc = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            w!("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize"),
            w!("SystemUsesLightTheme"),
            RRF_RT_REG_DWORD,
            None,
            Some((&mut data as *mut u32).cast()),
            Some(&mut len),
        )
    };
    rc.is_ok() && data == 1
}

#[cfg(not(target_os = "windows"))]
fn taskbar_is_light() -> bool {
    false
}

fn icon(recording: bool, paused: bool) -> Option<Image<'static>> {
    let light = taskbar_is_light();
    let bytes = if recording {
        RECORDING
    } else if paused {
        if light { PAUSED } else { PAUSED_DARK }
    } else if light {
        IDLE
    } else {
        IDLE_DARK
    };
    Image::from_bytes(bytes).ok()
}

/// Swap the tray glyph for the current state.
pub fn sync_icon(app: &AppHandle, recording: bool, paused: bool) {
    if let (Some(tray), Some(img)) = (app.tray_by_id(TRAY_ID), icon(recording, paused)) {
        let _ = tray.set_icon(Some(img));
    }
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Utter", true, None::<&str>)?;
    let dictate = MenuItem::with_id(app, "dictate", "Start dictation (hands-free)", true, None::<&str>)?;
    let paste = MenuItem::with_id(app, "paste", "Paste last", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", "Pause Utter for 1 hour", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[&open, &dictate, &paste, &sep1, &pause, &settings, &sep2, &quit],
    )?;
    app.manage(PauseItem(pause));

    let mut b = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Utter")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| on_menu(app, event.id().as_ref()))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                crate::windows::show_hub(tray.app_handle(), None);
            }
        });
    if let Some(img) = icon(false, false) {
        b = b.icon(img);
    }
    b.build(app)?;
    Ok(())
}

fn on_menu(app: &AppHandle, id: &str) {
    let Some(st) = app.try_state::<Arc<AppState>>() else {
        return;
    };
    let st: Arc<AppState> = st.inner().clone();
    match id {
        "open" => crate::windows::show_hub(app, None),
        "settings" => crate::windows::show_hub(app, Some("settings")),
        "dictate" => {
            let _ = st
                .session_tx
                .send(SessionMsg::Hotkey(HotkeyEvent::Pressed(Action::HandsFree)));
        }
        "paste" => {
            let _ = st
                .session_tx
                .send(SessionMsg::Hotkey(HotkeyEvent::Pressed(Action::PasteLast)));
        }
        "pause" => toggle_pause(&st),
        "quit" => app.exit(0),
        _ => {}
    }
}

fn set_pause_label(app: &AppHandle, paused: bool) {
    if let Some(p) = app.try_state::<PauseItem>() {
        let _ = p
            .0
            .set_text(if paused { "Resume Utter" } else { "Pause Utter for 1 hour" });
    }
}

/// Pause or resume dictation (hotkeys are ignored while paused).
pub fn toggle_pause(st: &Arc<AppState>) {
    if st.is_paused() {
        *st.paused_until.lock() = None;
        set_pause_label(&st.app, false);
        sync_icon(&st.app, false, false);
        return;
    }
    let until = Instant::now() + Duration::from_secs(3600);
    *st.paused_until.lock() = Some(until);
    set_pause_label(&st.app, true);
    sync_icon(&st.app, false, true);
    let me = st.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(3600));
        // Only auto-resume if this pause is still the active one.
        if *me.paused_until.lock() == Some(until) {
            *me.paused_until.lock() = None;
            set_pause_label(&me.app, false);
            sync_icon(&me.app, false, false);
        }
    });
}
