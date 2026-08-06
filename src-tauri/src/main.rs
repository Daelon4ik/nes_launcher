mod commands;
mod db;
mod metadata;
mod netplay;
mod store;

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
            app.manage(Mutex::new(netplay::NetplayState::default()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::library::scan_library,
            commands::library::list_games,
            commands::library::install_games,
            commands::library::delete_game,
            commands::metadata::update_metadata,
            commands::emulator::launch_game,
            commands::emulator::read_rom_bytes,
            commands::saves::record_session,
            commands::saves::list_save_slots,
            commands::saves::save_state,
            commands::saves::load_state,
            commands::settings::get_theme,
            commands::settings::set_theme,
            commands::settings::get_rom_library_paths,
            commands::settings::set_rom_library_paths,
            commands::settings::get_network_display_name,
            commands::settings::set_network_display_name,
            commands::settings::get_network_host_port,
            commands::settings::set_network_host_port,
            commands::netplay::netplay_start_hosting,
            commands::netplay::netplay_stop_hosting,
            commands::netplay::netplay_start_discovery,
            commands::netplay::netplay_stop_discovery,
            commands::netplay::netplay_join_host,
            commands::netplay::netplay_send_input,
            commands::netplay::netplay_disconnect,
            commands::store::store_search,
            commands::store::store_browse,
            commands::store::store_list_files,
            commands::store::store_install,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
