/// Возвращает данные, необходимые frontend'у для запуска ROM во встроенном эмуляторе.
#[tauri::command]
pub fn launch_game(game_id: i64) -> Result<String, String> {
    todo!("получить путь к ROM по game_id и вернуть его на frontend")
}
