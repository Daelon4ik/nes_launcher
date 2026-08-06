use crate::commands::library::default_rom_dir;
use crate::commands::metadata::download_cover;
use crate::db;
use crate::db::models::Game;
use crate::metadata::scraper::fetch_metadata_by_url;
use crate::store::scraper::{self, StoreFile, StoreGameSummary, StoreListingPage};
use rusqlite::Connection;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn store_search(query: String) -> Result<Vec<StoreGameSummary>, String> {
    scraper::search(&query).await
}

#[tauri::command]
pub async fn store_browse(letter: String, page: u32) -> Result<StoreListingPage, String> {
    scraper::browse_letter(&letter, page).await
}

#[tauri::command]
pub async fn store_list_files(slug: String) -> Result<Vec<StoreFile>, String> {
    scraper::list_files(&slug).await
}

/// Скачивает выбранный файл, распаковывает единственный .nes из архива, регистрирует
/// его в библиотеке (тем же способом, что install_games для вручную выбранных
/// файлов — см. commands::library) и сразу подтягивает описание/обложку/режим игры
/// с той же страницы emu-land.net (best-effort — см. try_fetch_metadata).
///
/// `title` — каноническое название игры с самой карточки магазина (то, что
/// вернул store_search/store_browse), а не имя файла внутри архива: у файлов в
/// архиве оно часто содержит регион/язык/ревизию ("Contra (Japan) (En) (Rev
/// 1)"). Используется и для имени файла на диске, и для поиска метаданных.
#[tauri::command]
pub async fn store_install(
    db: State<'_, Mutex<Connection>>,
    app: AppHandle,
    slug: String,
    fid: String,
    title: String,
    target_dir: Option<String>,
) -> Result<Vec<Game>, String> {
    let id = scraper::resolve_game_id(&slug).await?;
    let zip_bytes = scraper::download_zip(&id, &fid).await?;
    let rom_bytes = extract_nes_from_zip(&zip_bytes)?;

    let dir = {
        let conn = db.lock().map_err(|e| e.to_string())?;
        resolve_install_dir(&conn, &app, target_dir)?
    };
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let filename = format!("{}.nes", sanitize_filename(&title));
    let dest = unique_path(&dir, &filename);
    std::fs::write(&dest, &rom_bytes).map_err(|e| e.to_string())?;
    let rom_path = dest.to_string_lossy().to_string();

    let now = chrono::Utc::now().to_rfc3339();
    let game_id = {
        let conn = db.lock().map_err(|e| e.to_string())?;
        db::insert_game_if_missing(&conn, &title, &rom_path, &now).map_err(|e| e.to_string())?;
        db::game_id_by_rom_path(&conn, &rom_path)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Не удалось найти только что установленную игру в библиотеке".to_string())?
    };

    // Страницу игры на emu-land.net уже находили выше по slug (resolve_game_id) —
    // используем тот же slug, чтобы не искать заново по названию. Best-effort: сбой
    // сети или разметки сайта не должен откатывать уже выполненную установку игры,
    // просто останется без описания/обложки — как и у вручную добавленных файлов,
    // metadata можно дозагрузить кнопкой «Обновить» на вкладке «Метаданные».
    if let Err(err) = try_fetch_metadata(&db, &app, game_id, &slug).await {
        eprintln!("Не удалось автоматически загрузить метаданные для «{title}»: {err}");
    }

    let conn = db.lock().map_err(|e| e.to_string())?;
    db::list_games(&conn).map_err(|e| e.to_string())
}

async fn try_fetch_metadata(
    db: &State<'_, Mutex<Connection>>,
    app: &AppHandle,
    game_id: i64,
    slug: &str,
) -> Result<(), String> {
    let scraped = fetch_metadata_by_url(&scraper::game_page_url(slug)).await?;

    let cover_path = match &scraped.cover_url {
        Some(url) => Some(download_cover(app, game_id, url).await?),
        None => None,
    };

    let conn = db.lock().map_err(|e| e.to_string())?;
    db::update_game_metadata(
        &conn,
        game_id,
        scraped.description.as_deref(),
        cover_path.as_deref(),
        scraped.player_mode.as_deref(),
    )
    .map_err(|e| e.to_string())
}

/// Название игры может содержать символы, недопустимые в имени файла на диске
/// (сами по себе игровые тайтлы иногда несут ":", "?" и т.п. — например "Kirby's
/// Adventure"). Заменяет их дефисом, схлопывает пробелы, обрезает края.
fn sanitize_filename(title: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|c| if r#"/\:*?"<>|"#.contains(c) { '-' } else { c })
        .collect();
    let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = collapsed.trim_matches(['.', ' ']);
    if trimmed.is_empty() {
        "ROM".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Папка для установки: если пользователь явно выбрал одну из настроенных (несколько
/// путей в Settings.rom_library_paths — фронтенд должен был спросить), используем её
/// (сверяя со списком настроенных, чтобы команда не могла быть вызвана с произвольным
/// путём на диске). Если путь в Settings один — используем его без вопросов, если ни
/// одного не настроено — дефолтная `<app-data>/roms` (та же, что у сканирования).
fn resolve_install_dir(
    conn: &Connection,
    app: &AppHandle,
    target_dir: Option<String>,
) -> Result<PathBuf, String> {
    let configured: Vec<String> = match db::get_setting(conn, "rom_library_paths").map_err(|e| e.to_string())? {
        Some(json) => serde_json::from_str(&json).map_err(|e| e.to_string())?,
        None => Vec::new(),
    };

    if let Some(dir) = target_dir {
        return if configured.iter().any(|p| p == &dir) {
            Ok(PathBuf::from(dir))
        } else {
            Err("Указанная папка не входит в настроенные пути библиотеки".to_string())
        };
    }

    match configured.len() {
        0 => default_rom_dir(app),
        1 => Ok(PathBuf::from(configured.into_iter().next().unwrap())),
        _ => Err(
            "Настроено несколько папок библиотеки — нужно явно указать, куда устанавливать"
                .to_string(),
        ),
    }
}

/// Единственный .nes из скачанного .zip. Имя файла на диске определяется отдельно
/// из названия игры (см. store_install) — имя внутри архива не используется, так
/// что содержимому zip-записи не нужно доверять даже как basename.
fn extract_nes_from_zip(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let reader = std::io::Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(reader).map_err(|e| e.to_string())?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        if entry.is_dir() {
            continue;
        }
        if !entry.name().to_lowercase().ends_with(".nes") {
            continue;
        }

        let mut data = Vec::new();
        entry.read_to_end(&mut data).map_err(|e| e.to_string())?;
        return Ok(data);
    }

    Err("В скачанном архиве не найден .nes файл".to_string())
}

/// Избегает перезаписи при повторной установке/совпадении имён — "Contra.nes",
/// "Contra (2).nes", ...
fn unique_path(dir: &Path, filename: &str) -> PathBuf {
    let candidate = dir.join(filename);
    if !candidate.exists() {
        return candidate;
    }

    let stem = Path::new(filename).file_stem().and_then(|s| s.to_str()).unwrap_or(filename);
    let ext = Path::new(filename).extension().and_then(|s| s.to_str());

    let mut n = 2;
    loop {
        let name = match ext {
            Some(ext) => format!("{stem} ({n}).{ext}"),
            None => format!("{stem} ({n})"),
        };
        let candidate = dir.join(&name);
        if !candidate.exists() {
            return candidate;
        }
        n += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_plain_title() {
        assert_eq!(sanitize_filename("Contra"), "Contra");
    }

    #[test]
    fn replaces_path_separators_and_reserved_characters() {
        assert_eq!(sanitize_filename("Kirby's Adventure: Part 2/3?"), "Kirby's Adventure- Part 2-3-");
    }

    #[test]
    fn collapses_whitespace_and_trims_edges() {
        assert_eq!(sanitize_filename("  Duck   Hunt  "), "Duck Hunt");
    }

    #[test]
    fn falls_back_when_title_sanitizes_to_empty() {
        assert_eq!(sanitize_filename("..."), "ROM");
    }
}
