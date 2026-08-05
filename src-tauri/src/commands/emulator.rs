use crate::db;
use rusqlite::Connection;
use std::sync::Mutex;
use tauri::State;

/// Возвращает путь к ROM по game_id, необходимый frontend'у для запуска встроенного эмулятора.
#[tauri::command]
pub fn launch_game(db: State<'_, Mutex<Connection>>, game_id: i64) -> Result<String, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    db::game_rom_path(&conn, game_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Игра с id={game_id} не найдена"))
}
