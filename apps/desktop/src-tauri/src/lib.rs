//! Utter: free, open source dictation for Windows.

pub mod app_state;
pub mod audio;
pub mod commands;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Utter");
}
