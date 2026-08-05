mod commands;
mod db;
mod metadata;

use std::sync::Mutex;
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_dir)?;
            let conn = db::init(&app_dir.join("nes_launhder.db"))?;
            app.manage(Mutex::new(conn));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::library::scan_library,
            commands::library::list_games,
            commands::library::install_games,
            commands::metadata::update_metadata,
            commands::emulator::launch_game,
            commands::saves::record_session,
            commands::settings::get_theme,
            commands::settings::set_theme,
            commands::settings::get_rom_library_paths,
            commands::settings::set_rom_library_paths,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
