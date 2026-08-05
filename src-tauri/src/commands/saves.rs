use crate::db;
use chrono::{Duration, Utc};
use rusqlite::Connection;
use std::sync::Mutex;
use tauri::State;

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
