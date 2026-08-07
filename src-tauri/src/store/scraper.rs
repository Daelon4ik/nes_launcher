use crate::metadata::scraper::{build_client, normalize_url, BASE_URL, NES_SECTION_ID};
use scraper::{Html, Selector};

/// Раздел Sega Genesis/Mega Drive на emu-land.net — второй раздел, параллельный
/// NES/Dendy (см. docs/platforms.md). Id и путь проверены вживую тем же способом,
/// что и NES_SECTION_ID/дефолтный ROMS_PATH — форма "Поиск в разделе" на странице
/// `/consoles/genesis/roms/<letter>` содержит `<input type="hidden" name="id" value="39">`.
/// Только для Store — metadata::scraper (поиск метаданных по названию) пока не
/// платформозависим, использует NES_SECTION_ID безусловно.
const GENESIS_SECTION_ID: &str = "39";

/// Платформа магазина — какой раздел emu-land.net используется для поиска/просмотра/
/// установки (см. docs/platforms.md). Строковые значения ("nes"/"genesis") приходят
/// от фронтенда как параметр Tauri-команды (переключатель на Store Screen).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StorePlatform {
    Nes,
    Genesis,
}

impl StorePlatform {
    fn section_id(self) -> &'static str {
        match self {
            StorePlatform::Nes => NES_SECTION_ID,
            StorePlatform::Genesis => GENESIS_SECTION_ID,
        }
    }

    fn roms_path(self) -> &'static str {
        match self {
            StorePlatform::Nes => "/consoles/dendy/roms",
            StorePlatform::Genesis => "/consoles/genesis/roms",
        }
    }

    /// Расширение файла ROM внутри скачанного .zip и на диске после установки.
    pub fn rom_extension(self) -> &'static str {
        match self {
            StorePlatform::Nes => "nes",
            StorePlatform::Genesis => "gen",
        }
    }
}

/// Буквы алфавитных вкладок раздела ROM'ов — ровно то, что реально есть в навигации
/// сайта (проверено вживую). Используется и фронтендом (для вкладок), и бэкендом
/// (белый список для letter, чтобы он не попадал в URL как есть без проверки).
pub const BROWSE_LETTERS: &[&str] = &[
    "0-9", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q",
    "r", "s", "t", "u", "v", "w", "x", "y", "z",
];

/// Возвращаются напрямую из Tauri-команд (см. commands::store) — camelCase
/// соответствует src/types/store.ts на фронтенде, как и модели в db/models.rs.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreGameSummary {
    pub slug: String,
    pub title: String,
    /// Превью-картинка со страницы поиска/списка (`ss.emu-land.net`, тот же хост, что
    /// блокирует хотлинки по Referer у обложек метаданных, см. commands::store::store_cover_image) —
    /// абсолютный URL, готовый передать в store_cover_image для скачивания/кэширования.
    pub image_url: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreListingPage {
    pub games: Vec<StoreGameSummary>,
    pub total_pages: u32,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreFile {
    pub fid: String,
    pub name: String,
    pub size: Option<String>,
    pub section: String,
}

/// Полнотекстовый поиск по разделу (NES/Dendy или Genesis — см. `StorePlatform`) —
/// тот же эндпоинт, что использует metadata::scraper для поиска одной игры по
/// названию (правда, там всегда NES_SECTION_ID безусловно), но здесь возвращаем все
/// совпадения (не только первое/точное), чтобы пользователь сам выбрал нужное.
pub async fn search(query: &str, platform: StorePlatform) -> Result<Vec<StoreGameSummary>, String> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }

    let client = build_client()?;
    let html = client
        .get(format!("{BASE_URL}/search_games"))
        .query(&[("id", platform.section_id()), ("q", query)])
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    let document = Html::parse_document(&html);
    // Контейнер — весь <p>, а не сразу <a>: рядом с ссылкой в той же разметке лежит
    // превью-картинка (<img class="preview">), нужная тем же селектором не достать.
    let row_selector = Selector::parse(".fllinks p").unwrap();
    let link_selector = Selector::parse("a").unwrap();
    let image_selector = Selector::parse("img").unwrap();

    Ok(document
        .select(&row_selector)
        .filter_map(|row| {
            let link = row.select(&link_selector).next()?;
            let href = link.value().attr("href")?;
            let slug = slug_from_roms_href(href, platform)?;
            let title: String = link.text().collect();
            let image_url = row
                .select(&image_selector)
                .next()
                .and_then(|el| el.value().attr("src"))
                .map(normalize_url);
            Some(StoreGameSummary { slug, title: title.trim().to_string(), image_url })
        })
        .collect())
}

/// Ручной просмотр по алфавитным вкладкам (фолбэк, когда поиск ничего не нашёл, или
/// пользователь просто листает раздел) — см. docs/store.md.
pub async fn browse_letter(letter: &str, page: u32, platform: StorePlatform) -> Result<StoreListingPage, String> {
    if !BROWSE_LETTERS.contains(&letter) {
        return Err(format!("Неизвестная буква раздела: «{letter}»"));
    }
    let page = page.max(1);
    let roms_path = platform.roms_path();

    let client = build_client()?;
    let url = if page == 1 {
        format!("{BASE_URL}{roms_path}/{letter}")
    } else {
        format!("{BASE_URL}{roms_path}/{letter}/{page}")
    };
    let html = client
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    let document = Html::parse_document(&html);

    let container_selector = Selector::parse(".fcontainer").unwrap();
    let title_selector = Selector::parse(".rheader a").unwrap();
    let image_selector = Selector::parse(".picture img").unwrap();
    let games: Vec<StoreGameSummary> = document
        .select(&container_selector)
        .filter_map(|container| {
            let link = container.select(&title_selector).next()?;
            let href = link.value().attr("href")?;
            let slug = slug_from_roms_href(href, platform)?;
            let title: String = link.text().collect();
            let image_url = container
                .select(&image_selector)
                .next()
                .and_then(|el| el.value().attr("src"))
                .map(normalize_url);
            Some(StoreGameSummary { slug, title: title.trim().to_string(), image_url })
        })
        .collect();

    let last_page_selector = Selector::parse(".num a[title=\"Последняя\"]").unwrap();
    let total_pages = document
        .select(&last_page_selector)
        .next()
        .and_then(|el| el.value().attr("href"))
        .and_then(trailing_page_number)
        .unwrap_or(1);

    Ok(StoreListingPage { games, total_pages })
}

/// Список файлов игры (все разделы сайта — «Основные», «Пиратки», «Переведённые» и
/// т.д. — вперемешку, раздел указан в StoreFile::section). Только .zip: некоторые
/// записи на сайте — целые наборы GoodNES в .7z, распаковка которых не
/// поддерживается (см. commands::store::extract_rom_from_zip).
pub async fn list_files(slug: &str, platform: StorePlatform) -> Result<Vec<StoreFile>, String> {
    let id = resolve_game_id(slug, platform).await?;
    let roms_path = platform.roms_path();

    let client = build_client()?;
    let html = client
        .get(format!("{BASE_URL}{roms_path}"))
        .query(&[("act", "getmfl"), ("id", &id)])
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    let document = Html::parse_document(&html);
    let section_selector = Selector::parse(".collaps-item").unwrap();
    let section_title_selector = Selector::parse(".title span").unwrap();
    let item_selector = Selector::parse(".item").unwrap();
    let file_link_selector = Selector::parse(".file > a").unwrap();
    let size_selector = Selector::parse(".size").unwrap();

    let mut files = Vec::new();
    for section in document.select(&section_selector) {
        let section_name = section
            .select(&section_title_selector)
            .next()
            .map(|el| el.text().collect::<String>().trim().to_string())
            .unwrap_or_else(|| "Файлы".to_string());

        for item in section.select(&item_selector) {
            let Some(link) = item.select(&file_link_selector).next() else { continue };
            let name: String = link.text().collect();
            let name = name.trim().to_string();
            if !name.to_lowercase().ends_with(".zip") {
                continue;
            }
            let Some(href) = link.value().attr("href") else { continue };
            let Some(fid) = query_param(href, "fid") else { continue };
            let size = item
                .select(&size_selector)
                .next()
                .map(|el| el.text().collect::<String>().trim().to_string());

            files.push(StoreFile { fid, name, size, section: section_name.clone() });
        }
    }

    Ok(files)
}

/// Скачивает выбранный .zip игры (id игры + fid конкретного файла — см. list_files).
pub async fn download_zip(id: &str, fid: &str, platform: StorePlatform) -> Result<Vec<u8>, String> {
    let roms_path = platform.roms_path();
    let client = build_client()?;
    let bytes = client
        .get(format!("{BASE_URL}{roms_path}"))
        .query(&[("act", "getmfl"), ("id", id), ("fid", fid)])
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;
    Ok(bytes.to_vec())
}

/// Числовой id игры (нужен для getmfl) не приходит со страниц поиска/списков —
/// только со страницы самой игры, где он зашит в JS-обработчик кнопки скачивания
/// (`onclick="mgame('...act=getmfl&id=24602', ...)"`). Первое вхождение в HTML —
/// всегда сама игра (ROM-хаки, если есть, идут в разметке ниже, см. docs/store.md).
/// pub(crate): вызывается и отсюда (list_files), и напрямую из commands::store при
/// установке — список файлов и установка идут отдельными запросами пользователя
/// (открыл список → нажал «Установить» позже), так что id нужно резолвить заново.
pub(crate) async fn resolve_game_id(slug: &str, platform: StorePlatform) -> Result<String, String> {
    let client = build_client()?;
    let html = client
        .get(game_page_url(slug, platform))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    extract_first_game_id(&html)
        .ok_or_else(|| format!("Не удалось определить id игры «{slug}» на emu-land.net"))
}

/// pub(crate): переиспользуется в commands::store для автозагрузки метаданных сразу
/// после установки — та же страница игры, что и для резолва id выше, но запрашивается
/// отдельно (см. commands::store::fetch_and_store_metadata), т.к. это два независимых
/// шага установки (скачать ROM / подтянуть описание), каждый может неудачно
/// завершиться сам по себе, не блокируя другой.
pub(crate) fn game_page_url(slug: &str, platform: StorePlatform) -> String {
    let roms_path = platform.roms_path();
    format!("{BASE_URL}{roms_path}/{slug}")
}

fn extract_first_game_id(html: &str) -> Option<String> {
    let marker = "act=getmfl&amp;id=";
    let start = html.find(marker)? + marker.len();
    let rest = &html[start..];
    let digits_len = rest.find(|c: char| !c.is_ascii_digit()).unwrap_or(rest.len());
    if digits_len == 0 {
        return None;
    }
    Some(rest[..digits_len].to_string())
}

/// "/consoles/dendy/roms/babel-no-tou" -> "babel-no-tou"; отсекает всё, что не
/// похоже на прямую ссылку на игру (пагинацию вида ".../b/2" и т.п.).
fn slug_from_roms_href(href: &str, platform: StorePlatform) -> Option<String> {
    let rest = href.strip_prefix(platform.roms_path())?.strip_prefix('/')?;
    if rest.is_empty() || rest.contains('/') || rest.contains('?') {
        return None;
    }
    Some(rest.to_string())
}

/// Достаёт номер страницы из хвоста ссылки пагинации ("/consoles/dendy/roms/b/6" -> 6).
fn trailing_page_number(href: &str) -> Option<u32> {
    let last_segment = href.rsplit('/').next()?;
    last_segment.parse().ok()
}

/// Значение query-параметра из relative URL вида "/path?act=x&id=1&fid=42".
fn query_param(url: &str, key: &str) -> Option<String> {
    let query = url.split('?').nth(1)?;
    for pair in query.split('&') {
        let mut parts = pair.splitn(2, '=');
        let k = parts.next()?;
        let v = parts.next().unwrap_or("");
        if k == key {
            // &amp; в HTML-атрибутах декодируется парсером scraper/html5ever
            // автоматически, так что здесь уже обычный "&", ничего доп. декодировать не надо.
            return Some(v.to_string());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_slug_from_game_link() {
        assert_eq!(
            slug_from_roms_href("/consoles/dendy/roms/babel-no-tou", StorePlatform::Nes),
            Some("babel-no-tou".to_string())
        );
    }

    #[test]
    fn extracts_slug_from_genesis_game_link() {
        assert_eq!(
            slug_from_roms_href("/consoles/genesis/roms/aladdin", StorePlatform::Genesis),
            Some("aladdin".to_string())
        );
    }

    #[test]
    fn rejects_pagination_links_as_slugs() {
        assert_eq!(slug_from_roms_href("/consoles/dendy/roms/b/2", StorePlatform::Nes), None);
        assert_eq!(slug_from_roms_href("/consoles/dendy/roms", StorePlatform::Nes), None);
    }

    #[test]
    fn rejects_wrong_platform_prefix() {
        // Genesis-путь не должен матчиться при парсинге под NES-платформой и наоборот.
        assert_eq!(slug_from_roms_href("/consoles/genesis/roms/aladdin", StorePlatform::Nes), None);
        assert_eq!(slug_from_roms_href("/consoles/dendy/roms/babel-no-tou", StorePlatform::Genesis), None);
    }

    #[test]
    fn parses_last_page_number() {
        assert_eq!(trailing_page_number("/consoles/dendy/roms/b/6"), Some(6));
    }

    #[test]
    fn extracts_fid_from_download_href() {
        assert_eq!(
            query_param("/consoles/dendy/roms?act=getmfl&id=24418&fid=8707", "fid"),
            Some("8707".to_string())
        );
    }

    #[test]
    fn extracts_first_game_id_from_detail_page_html() {
        let html = r#"<div class="fcontainer"><span onclick="mgame('/consoles/dendy/roms?act=getmfl&amp;id=24602', 'mfile_24602'); return false;"></span></div>
            <div class="fcontainer" id="hack"><span onclick="mgame('/consoles/dendy/roms?act=getmfl&amp;id=25738', 'mfile_25738'); return false;"></span></div>"#;
        assert_eq!(extract_first_game_id(html), Some("24602".to_string()));
    }

    // Реальные запросы на emu-land.net — не входят в обычный `cargo test`, только
    // `cargo test -- --ignored`. Структура сайта проверена вживую вручную при
    // реализации (см. docs/store.md), эти тесты — регрессионная проверка на будущее.
    #[tokio::test]
    #[ignore]
    async fn searches_real_game() {
        let results = search("Contra", StorePlatform::Nes).await.expect("search should succeed");
        let contra = results
            .iter()
            .find(|g| g.title == "Contra" && g.slug == "contra")
            .unwrap_or_else(|| {
                panic!(
                    "got: {:?}",
                    results.iter().map(|g| (&g.slug, &g.title)).collect::<Vec<_>>()
                )
            });
        let image_url = contra.image_url.as_deref().expect("search result should have a preview image");
        assert!(image_url.starts_with("https://ss.emu-land.net/"), "got: {image_url}");
    }

    #[tokio::test]
    #[ignore]
    async fn browses_real_letter_page() {
        let page = browse_letter("b", 1, StorePlatform::Nes).await.expect("browse should succeed");
        assert!(page.total_pages > 1, "got total_pages={}", page.total_pages);
        let babel = page
            .games
            .iter()
            .find(|g| g.slug == "babel-no-tou")
            .expect("should find babel-no-tou in listing");
        let image_url = babel.image_url.as_deref().expect("listing result should have a preview image");
        assert!(image_url.starts_with("https://ss.emu-land.net/"), "got: {image_url}");
    }

    #[tokio::test]
    #[ignore]
    async fn lists_real_files_and_downloads_one() {
        let files = list_files("babel-no-tou", StorePlatform::Nes)
            .await
            .expect("list_files should succeed");
        let file = files
            .iter()
            .find(|f| f.name.contains("Japan"))
            .expect("should find a Japan release");
        assert!(file.name.to_lowercase().ends_with(".zip"));

        let id = resolve_game_id("babel-no-tou", StorePlatform::Nes).await.expect("should resolve id");
        let bytes = download_zip(&id, &file.fid, StorePlatform::Nes).await.expect("download should succeed");
        assert!(!bytes.is_empty());
    }

    // Проверяет саму связку commands::store::try_fetch_metadata — game_page_url(slug)
    // должен вести на ту же страницу, что metadata::scraper умеет распарсить.
    #[tokio::test]
    #[ignore]
    async fn game_page_url_yields_parseable_metadata() {
        let url = game_page_url("contra", StorePlatform::Nes);
        let metadata = crate::metadata::scraper::fetch_metadata_by_url(&url)
            .await
            .expect("fetch_metadata_by_url should succeed");
        assert!(metadata.description.is_some());
        assert_eq!(metadata.player_mode.as_deref(), Some("coop"));
    }

    // Раздел Genesis/Mega Drive (id=39, /consoles/genesis/roms) — те же проверки, что
    // выше для NES, на реальных данных сайта (см. docs/platforms.md).
    #[tokio::test]
    #[ignore]
    async fn searches_real_genesis_game() {
        let results = search("Aladdin", StorePlatform::Genesis).await.expect("search should succeed");
        let aladdin = results.iter().find(|g| g.slug == "aladdin").unwrap_or_else(|| {
            panic!(
                "got: {:?}",
                results.iter().map(|g| (&g.slug, &g.title)).collect::<Vec<_>>()
            )
        });
        let image_url = aladdin.image_url.as_deref().expect("search result should have a preview image");
        assert!(image_url.starts_with("https://ss.emu-land.net/"), "got: {image_url}");
    }

    #[tokio::test]
    #[ignore]
    async fn browses_real_genesis_letter_page() {
        let page = browse_letter("a", 1, StorePlatform::Genesis).await.expect("browse should succeed");
        assert!(page.total_pages > 1, "got total_pages={}", page.total_pages);
        let addams = page
            .games
            .iter()
            .find(|g| g.slug == "the-addams-family")
            .expect("should find the-addams-family in listing");
        let image_url = addams.image_url.as_deref().expect("listing result should have a preview image");
        assert!(image_url.starts_with("https://ss.emu-land.net/"), "got: {image_url}");
    }

    #[tokio::test]
    #[ignore]
    async fn lists_real_genesis_files_and_downloads_one() {
        let files = list_files("the-addams-family", StorePlatform::Genesis)
            .await
            .expect("list_files should succeed");
        let file = files
            .iter()
            .find(|f| f.name.contains("USA"))
            .expect("should find a USA release");
        assert!(file.name.to_lowercase().ends_with(".zip"));

        let id = resolve_game_id("the-addams-family", StorePlatform::Genesis)
            .await
            .expect("should resolve id");
        let bytes = download_zip(&id, &file.fid, StorePlatform::Genesis)
            .await
            .expect("download should succeed");
        assert!(!bytes.is_empty());

        // Внутри архива должен быть .gen, не .nes (см. commands::store::extract_rom_from_zip).
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).expect("valid zip");
        let has_gen = (0..archive.len()).any(|i| {
            archive
                .by_index(i)
                .map(|e| e.name().to_lowercase().ends_with(".gen"))
                .unwrap_or(false)
        });
        assert!(has_gen, "expected a .gen file inside the archive");
    }

    #[tokio::test]
    #[ignore]
    async fn genesis_game_page_url_yields_parseable_metadata() {
        let url = game_page_url("aladdin", StorePlatform::Genesis);
        let metadata = crate::metadata::scraper::fetch_metadata_by_url(&url)
            .await
            .expect("fetch_metadata_by_url should succeed");
        assert!(metadata.description.is_some());
    }
}
