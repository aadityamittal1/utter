//! Utter: free, open source dictation for Windows.

pub mod app_state;
pub mod audio;
pub mod commands;
pub mod commands_data;
pub mod context;
pub mod hotkeys;
pub mod insert;
pub mod llm;
pub mod pipeline;
pub mod secrets;
pub mod settings;
pub mod sounds;
pub mod store;
pub mod stt;
pub mod text;
pub mod tray;
pub mod windows;

use app_state::AppState;
use hotkeys::hook_windows::{start_hook, HookHandle, RawKey};
use parking_lot::Mutex;
use pipeline::session::{self, SessionMsg};
use std::sync::mpsc;
use std::time::Duration;
use tauri::{Manager, RunEvent, WindowEvent};
use tauri_plugin_autostart::ManagerExt;

/// Holds the keyboard hook so it can be removed on exit.
struct HookSlot(Mutex<Option<HookHandle>>);

fn show_hub_on_start() -> bool {
    !std::env::args().any(|a| a == "--minimized")
}

fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle().clone();
    let data_dir = app.path().app_data_dir()?;
    let (tx, rx) = mpsc::channel::<SessionMsg>();
    let st = AppState::new(handle.clone(), data_dir, tx).map_err(|e| e.to_string())?;
    app.manage(st.clone());
    session::spawn(st.clone(), rx);

    windows::create_pill(&handle)?;
    tray::create(&handle)?;
    let pill_now = st.pill.lock().clone();
    windows::sync_pill(&handle, &pill_now, st.pill_allowed());

    // Keyboard hook -> session worker.
    let (ktx, krx) = mpsc::channel::<RawKey>();
    let hook = match start_hook(st.matcher.clone(), ktx) {
        Ok(h) => Some(h),
        Err(e) => {
            log::error!("keyboard hook failed to start: {e}");
            None
        }
    };
    app.manage(HookSlot(Mutex::new(hook)));
    let fwd = st.clone();
    std::thread::Builder::new()
        .name("utter-hotkey-forward".into())
        .spawn(move || {
            for raw in krx {
                for ev in raw.events {
                    let _ = fwd.session_tx.send(SessionMsg::Hotkey(ev));
                }
            }
        })?;

    // History retention: at startup and hourly.
    st.purge_history();
    let purger = st.clone();
    std::thread::Builder::new()
        .name("utter-purge".into())
        .spawn(move || loop {
            std::thread::sleep(Duration::from_secs(3600));
            purger.purge_history();
        })?;

    commands::preload_engine(&st);

    // Launch at login (not for dev builds, which would register a debug exe).
    if !cfg!(debug_assertions) {
        let want = st.settings.read().launch_at_login;
        if handle.autolaunch().is_enabled().unwrap_or(false) != want {
            commands::set_autostart(&handle, want);
        }
    }

    if show_hub_on_start() {
        windows::show_hub(&handle, None);
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        // Single-instance first: a second launch must exit before anything else initialises.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            windows::show_hub(app, None);
        }))
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::update_settings,
            commands::reset_shortcuts,
            commands::complete_onboarding,
            commands::app_info,
            commands::api_key_status,
            commands::set_api_key,
            commands::clear_api_key,
            commands::test_api_key,
            commands::list_models,
            commands::download_model,
            commands::cancel_download,
            commands::delete_model,
            commands::set_active_model,
            commands::list_microphones,
            commands::start_mic_test,
            commands::stop_mic_test,
            commands::start_shortcut_capture,
            commands::stop_shortcut_capture,
            commands::pill_action,
            commands_data::history_list,
            commands_data::history_update_text,
            commands_data::history_retry,
            commands_data::history_insert,
            commands_data::history_copy,
            commands_data::history_audio_path,
            commands_data::history_delete,
            commands_data::history_clear,
            commands_data::dictionary_list,
            commands_data::dictionary_add,
            commands_data::dictionary_update,
            commands_data::dictionary_delete,
            commands_data::dictionary_import_csv,
            commands_data::dictionary_export_csv,
            commands_data::snippets_list,
            commands_data::snippets_add,
            commands_data::snippets_update,
            commands_data::snippets_delete,
            commands_data::snippets_import_csv,
            commands_data::snippets_export_csv,
            commands_data::transforms_list,
            commands_data::transforms_add,
            commands_data::transforms_update,
            commands_data::transforms_delete,
            commands_data::notes_list,
            commands_data::notes_create,
            commands_data::notes_update,
            commands_data::notes_delete,
            commands_data::insights_get,
            commands_data::usage_get,
        ])
        .setup(setup)
        .on_window_event(|window, event| {
            // Closing the hub hides it to the tray.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == windows::HUB_LABEL {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Utter");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            if let Some(slot) = app.try_state::<HookSlot>() {
                // Take the handle first so no lock is held while the hook thread stops.
                let h = slot.0.lock().take();
                if let Some(h) = h {
                    h.stop();
                }
            }
        }
    });
}

