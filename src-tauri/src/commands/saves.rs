use crate::db;
use crate::db::models::SaveSlot;
use chrono::{Duration, Utc};
use rusqlite::Connection;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

/// Число слотов сохранения на игру, показываемых в UI (см. Emulator Screen).
const SAVE_SLOT_COUNT: i64 = 3;

/// Записывает завершённую игровую сессию и обновляет статистику игры
/// (Game.last_played_at / total_playtime_seconds).
#[tauri::command]
pub fn record_session(
    db: State<'_, Mutex<Connection>>,
    game_id: i64,
    duration_seconds: i64,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;

    let ended_at = Utc::now();
    let started_at = ended_at - Duration::seconds(duration_seconds.max(0));

    db::record_session(
        &conn,
        game_id,
        duration_seconds,
        &started_at.to_rfc3339(),
        &ended_at.to_rfc3339(),
    )
    .map_err(|e| e.to_string())
}

/// Возвращает фиксированный набор слотов (1..=SAVE_SLOT_COUNT) — пустые слоты
/// приходят с created_at = null, чтобы фронтенд мог отрисовать их сразу без
/// отдельного запроса на каждый.
#[tauri::command]
pub fn list_save_slots(db: State<'_, Mutex<Connection>>, game_id: i64) -> Result<Vec<SaveSlot>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let existing = db::list_save_states(&conn, game_id).map_err(|e| e.to_string())?;

    let slots = (1..=SAVE_SLOT_COUNT)
        .map(|slot| SaveSlot {
            slot,
            created_at: existing.iter().find(|s| s.slot == slot).and_then(|s| s.created_at.clone()),
        })
        .collect();
    Ok(slots)
}

fn saves_dir(app: &AppHandle, game_id: i64) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("saves").join(game_id.to_string());
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Сохраняет снимок состояния эмулятора (JSON от jsnes `nes.toJSON()`) в слот,
/// перезаписывая файл, если слот уже был занят.
#[tauri::command]
pub fn save_state(
    db: State<'_, Mutex<Connection>>,
    app: AppHandle,
    game_id: i64,
    slot: i64,
    data: String,
) -> Result<(), String> {
    let dest = saves_dir(&app, game_id)?.join(format!("slot_{slot}.json"));
    std::fs::write(&dest, data).map_err(|e| e.to_string())?;

    let conn = db.lock().map_err(|e| e.to_string())?;
    db::upsert_save_state(&conn, game_id, slot, &dest.to_string_lossy(), &Utc::now().to_rfc3339())
        .map_err(|e| e.to_string())
}

/// Читает JSON снимок состояния эмулятора из слота — фронтенд передаёт его в `nes.fromJSON()`.
#[tauri::command]
pub fn load_state(db: State<'_, Mutex<Connection>>, game_id: i64, slot: i64) -> Result<String, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let path = db::save_state_file_path(&conn, game_id, slot)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Слот {slot} пуст"))?;
    drop(conn);

    std::fs::read_to_string(&path).map_err(|e| format!("Не удалось прочитать {path}: {e}"))
}
