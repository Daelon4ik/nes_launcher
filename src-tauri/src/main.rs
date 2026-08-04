mod commands;
mod db;
mod metadata;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::library::scan_library,
            commands::library::list_games,
            commands::emulator::launch_game,
            commands::saves::record_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
