use crate::db;
use crate::db::models::Game;
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

/// Сканирует настроенные папки с ROM'ами (или дефолтную `<app-data>/roms`, если
/// пользователь ещё не настроил путь в Settings) и добавляет новые файлы в библиотеку.
#[tauri::command]
pub fn scan_library(db: State<'_, Mutex<Connection>>, app: AppHandle) -> Result<Vec<Game>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;

    let rom_dirs = resolve_rom_dirs(&conn, &app)?;
    let now = chrono::Utc::now().to_rfc3339();

    for dir in rom_dirs {
        for rom_path in find_rom_files(&dir).map_err(|e| e.to_string())? {
            let title = humanize_title(&rom_path);
            db::insert_game_if_missing(&conn, &title, &rom_path.to_string_lossy(), &now)
                .map_err(|e| e.to_string())?;
        }
    }

    db::list_games(&conn).map_err(|e| e.to_string())
}

/// Возвращает текущую библиотеку игр из БД.
#[tauri::command]
pub fn list_games(db: State<'_, Mutex<Connection>>) -> Result<Vec<Game>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    db::list_games(&conn).map_err(|e| e.to_string())
}

/// Добавляет игры по путям к конкретным ROM-файлам (кнопка «Добавить игры» на
/// Main Screen, файлы выбраны в системном диалоге). В отличие от scan_library,
/// не привязано к настроенным папкам — можно выбрать файл откуда угодно на диске.
#[tauri::command]
pub fn install_games(db: State<'_, Mutex<Connection>>, paths: Vec<String>) -> Result<Vec<Game>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    for raw_path in paths {
        if !is_nes_rom(Path::new(&raw_path)) {
            continue;
        }
        let title = humanize_title(Path::new(&raw_path));
        db::insert_game_if_missing(&conn, &title, &raw_path, &now).map_err(|e| e.to_string())?;
    }

    db::list_games(&conn).map_err(|e| e.to_string())
}

/// Удаляет игру: строку в БД (и связанные сессии/сохранения) + ROM-файл и обложку
/// на диске. Отсутствие файла на диске не считаем ошибкой (best-effort), чтобы
/// не блокировать удаление записи из библиотеки.
#[tauri::command]
pub fn delete_game(db: State<'_, Mutex<Connection>>, game_id: i64) -> Result<Vec<Game>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let game = db::get_game(&conn, game_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Игра с id={game_id} не найдена"))?;

    let _ = std::fs::remove_file(&game.rom_path);
    if let Some(cover_path) = &game.cover_path {
        let _ = std::fs::remove_file(cover_path);
    }

    db::delete_game(&conn, game_id).map_err(|e| e.to_string())?;
    db::list_games(&conn).map_err(|e| e.to_string())
}

/// Папки для сканирования: из `Settings.rom_library_paths`, если заданы,
/// иначе — дефолтная `<app-data>/roms` (создаётся при отсутствии).
fn resolve_rom_dirs(conn: &Connection, app: &AppHandle) -> Result<Vec<PathBuf>, String> {
    if let Some(json) = db::get_setting(conn, "rom_library_paths").map_err(|e| e.to_string())? {
        let paths: Vec<String> = serde_json::from_str(&json).map_err(|e| e.to_string())?;
        if !paths.is_empty() {
            return Ok(paths.into_iter().map(PathBuf::from).collect());
        }
    }

    let default_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("roms");
    std::fs::create_dir_all(&default_dir).map_err(|e| e.to_string())?;
    Ok(vec![default_dir])
}

fn find_rom_files(dir: &Path) -> std::io::Result<Vec<PathBuf>> {
    let mut result = Vec::new();
    if !dir.is_dir() {
        return Ok(result);
    }
    for entry in std::fs::read_dir(dir)? {
        let path = entry?.path();
        if path.is_dir() {
            result.extend(find_rom_files(&path)?);
        } else if is_nes_rom(&path) {
            result.push(path);
        }
    }
    Ok(result)
}

fn is_nes_rom(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("nes"))
}

fn humanize_title(rom_path: &Path) -> String {
    let stem = rom_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Unknown");
    stem.replace(['_', '-'], " ").trim().to_string()
}
