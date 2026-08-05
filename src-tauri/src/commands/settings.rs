use crate::db;
use rusqlite::Connection;
use std::sync::Mutex;
use tauri::State;

const DEFAULT_THEME: &str = "system";

/// Тема оформления лаунчера ("light" | "dark" | "system"). См. docs/data-model.md.
#[tauri::command]
pub fn get_theme(db: State<'_, Mutex<Connection>>) -> Result<String, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    Ok(db::get_setting(&conn, "theme")
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| DEFAULT_THEME.to_string()))
}

#[tauri::command]
pub fn set_theme(db: State<'_, Mutex<Connection>>, theme: String) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    db::set_setting(&conn, "theme", &theme).map_err(|e| e.to_string())
}

/// Папки с ROM'ами, настроенные пользователем. Пустой список — сканирование
/// использует дефолтную `<app-data>/roms` (см. commands::library::resolve_rom_dirs).
#[tauri::command]
pub fn get_rom_library_paths(db: State<'_, Mutex<Connection>>) -> Result<Vec<String>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    match db::get_setting(&conn, "rom_library_paths").map_err(|e| e.to_string())? {
        Some(json) => serde_json::from_str(&json).map_err(|e| e.to_string()),
        None => Ok(Vec::new()),
    }
}

#[tauri::command]
pub fn set_rom_library_paths(db: State<'_, Mutex<Connection>>, paths: Vec<String>) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let json = serde_json::to_string(&paths).map_err(|e| e.to_string())?;
    db::set_setting(&conn, "rom_library_paths", &json).map_err(|e| e.to_string())
}
