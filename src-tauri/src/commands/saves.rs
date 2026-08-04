/// Записывает завершённую игровую сессию и обновляет статистику игры.
#[tauri::command]
pub fn record_session(game_id: i64, duration_seconds: i64) -> Result<(), String> {
    todo!("записать PlaySession и обновить Game.last_played_at / total_playtime_seconds")
}
