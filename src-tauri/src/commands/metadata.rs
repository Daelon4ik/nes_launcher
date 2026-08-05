use crate::db;
use crate::db::models::Game;
use crate::metadata::scraper::{download_image, fetch_metadata};
use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

/// Ищет описание и обложку игры на emu-land.net по её названию в библиотеке,
/// скачивает обложку в локальный кэш (ss.emu-land.net блокирует хотлинки — отдавать
/// URL напрямую в webview нельзя) и записывает найденное в БД.
#[tauri::command]
pub async fn update_metadata(
    db: State<'_, Mutex<Connection>>,
    app: AppHandle,
    game_id: i64,
) -> Result<Game, String> {
    let title = {
        let conn = db.lock().map_err(|e| e.to_string())?;
        db::get_game(&conn, game_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Игра с id={game_id} не найдена"))?
            .title
    };

    let scraped = fetch_metadata(&title).await?;

    let cover_path = match &scraped.cover_url {
        Some(url) => Some(download_cover(&app, game_id, url).await?),
        None => None,
    };

    let conn = db.lock().map_err(|e| e.to_string())?;
    db::update_game_metadata(
        &conn,
        game_id,
        scraped.description.as_deref(),
        cover_path.as_deref(),
    )
    .map_err(|e| e.to_string())?;

    db::get_game(&conn, game_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Игра с id={game_id} не найдена"))
}

async fn download_cover(app: &AppHandle, game_id: i64, url: &str) -> Result<String, String> {
    let bytes = download_image(url).await?;

    let covers_dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("covers");
    std::fs::create_dir_all(&covers_dir).map_err(|e| e.to_string())?;

    let ext = Path::new(url)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png");
    let dest = covers_dir.join(format!("{game_id}.{ext}"));
    std::fs::write(&dest, &bytes).map_err(|e| e.to_string())?;

    Ok(dest.to_string_lossy().to_string())
}
