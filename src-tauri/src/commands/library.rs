use crate::db::models::Game;

/// Сканирует настроенные папки с ROM'ами и обновляет библиотеку в БД.
#[tauri::command]
pub fn scan_library() -> Result<Vec<Game>, String> {
    todo!("сканирование папок с ROM'ами и запись в SQLite")
}

/// Возвращает текущую библиотеку игр из БД.
#[tauri::command]
pub fn list_games() -> Result<Vec<Game>, String> {
    todo!("чтение списка игр из SQLite")
}
