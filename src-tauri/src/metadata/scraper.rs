use scraper::{Html, Selector};

/// Источник метаданных и обложек игр — раздел Dendy/NES на emu-land.net.
const BASE_URL: &str = "https://www.emu-land.net";
/// Внутренний id раздела "Игры NES / Dendy" на emu-land.net (из формы /search_games).
const NES_SECTION_ID: &str = "13";
const USER_AGENT: &str = "Mozilla/5.0 (compatible; NESLauncher/0.1)";

pub struct ScrapedMetadata {
    pub description: Option<String>,
    pub cover_url: Option<String>,
    /// "single" | "alternating" | "coop" — см. `parse_player_mode`.
    pub player_mode: Option<String>,
}

fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| e.to_string())
}

/// Ищет игру по названию ROM на emu-land.net и парсит описание/обложку с её страницы.
pub async fn fetch_metadata(rom_title: &str) -> Result<ScrapedMetadata, String> {
    let client = build_client()?;

    let game_url = find_game_url(&client, rom_title)
        .await?
        .ok_or_else(|| format!("По названию «{rom_title}» ничего не найдено на emu-land.net"))?;

    fetch_game_page(&client, &game_url).await
}

/// Скачивает картинку по URL (обложку/скриншот) — например, для локального кэша,
/// т.к. ss.emu-land.net блокирует хотлинки по Referer и отдавать URL напрямую в webview нельзя.
pub async fn download_image(url: &str) -> Result<Vec<u8>, String> {
    let client = build_client()?;
    let bytes = client
        .get(url)
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

async fn find_game_url(client: &reqwest::Client, title: &str) -> Result<Option<String>, String> {
    let html = client
        .get(format!("{BASE_URL}/search_games"))
        .query(&[("id", NES_SECTION_ID), ("q", title)])
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    let document = Html::parse_document(&html);
    // Единственный блок результатов, т.к. фильтруем по id=13 (NES/Dendy).
    let link_selector = Selector::parse(".fllinks a").unwrap();

    let results: Vec<(String, String)> = document
        .select(&link_selector)
        .filter_map(|el| {
            let href = el.value().attr("href")?;
            let text: String = el.text().collect();
            Some((text.trim().to_string(), format!("{BASE_URL}{href}")))
        })
        .collect();

    // Поиск на emu-land.net не ранжирует точные совпадения выше пиратских клонов и
    // сиквелов (например, по "Contra" первым может прийти "Super Contra 7") — поэтому
    // сначала ищем точное совпадение по названию (без учёта регистра), и только если
    // такого нет, берём первый результат как наиболее вероятный.
    let exact = results
        .iter()
        .find(|(text, _)| text.eq_ignore_ascii_case(title));

    Ok(exact.or(results.first()).map(|(_, url)| url.clone()))
}

async fn fetch_game_page(client: &reqwest::Client, url: &str) -> Result<ScrapedMetadata, String> {
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

    // Первый абзац в первом .ftext — описание самой игры (следующие .ftext на странице
    // относятся к её ROM-хакам, если они есть, и идут ниже в документе).
    let description_selector = Selector::parse(".ftext > p").unwrap();
    let description = document.select(&description_selector).next().map(|el| {
        let text: String = el.text().collect();
        text.trim().to_string()
    });

    let cover_selector = Selector::parse(".ss-area img").unwrap();
    let cover_url = document
        .select(&cover_selector)
        .next()
        .and_then(|el| el.value().attr("src"))
        .map(normalize_url);

    // Строка вида «• Игроки: 2 (кооп)» лежит в общем блоке .finfo с другими
    // полями (жанр, разработчик...) — ищем среди них по префиксу "Игроки".
    let info_selector = Selector::parse(".finfo li").unwrap();
    let player_mode = document
        .select(&info_selector)
        .filter_map(|el| {
            let text: String = el.text().collect();
            parse_player_mode(&text)
        })
        .next();

    Ok(ScrapedMetadata { description, cover_url, player_mode })
}

/// Разбирает строку метаданных emu-land.net вида «Игроки: 1», «Игроки: 2 (по
/// очереди)» или «Игроки: 2 (кооп)» в "single" | "alternating" | "coop".
/// Возвращает None, если строка не про число игроков.
fn parse_player_mode(text: &str) -> Option<String> {
    let rest = text.trim().trim_start_matches('•').trim();
    let rest = rest.strip_prefix("Игроки:")?;

    let count: u32 = rest
        .trim()
        .split(|c: char| !c.is_ascii_digit())
        .find(|s| !s.is_empty())?
        .parse()
        .ok()?;

    let mode = if count <= 1 {
        "single"
    } else if rest.to_lowercase().contains("кооп") {
        "coop"
    } else {
        "alternating"
    };
    Some(mode.to_string())
}

fn normalize_url(src: &str) -> String {
    if let Some(rest) = src.strip_prefix("//") {
        format!("https://{rest}")
    } else if src.starts_with('/') {
        format!("{BASE_URL}{src}")
    } else {
        src.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Реальные строки, снятые со страниц emu-land.net (Metroid, Super Mario Bros, Contra).
    #[test]
    fn parses_single_player() {
        assert_eq!(parse_player_mode("• Игроки: 1 "), Some("single".to_string()));
    }

    #[test]
    fn parses_alternating_two_player() {
        assert_eq!(
            parse_player_mode("• Игроки: 2 (по очереди)"),
            Some("alternating".to_string())
        );
    }

    #[test]
    fn parses_coop_two_player() {
        assert_eq!(parse_player_mode("• Игроки: 2 (кооп)"), Some("coop".to_string()));
    }

    #[test]
    fn ignores_unrelated_info_lines() {
        assert_eq!(parse_player_mode("• Жанр: platform, shooter, run'n'gun"), None);
    }

    // Реальные запросы на emu-land.net — не входят в обычный `cargo test`, только
    // `cargo test -- --ignored`. Полезно перепроверить руками, если сайт поменяет разметку.
    #[tokio::test]
    #[ignore]
    async fn fetches_real_metadata_for_contra() {
        let result = fetch_metadata("Contra").await.expect("scrape should succeed");
        let description = result.description.expect("description should be found");
        assert!(description.to_lowercase().contains("контра"), "got: {description}");
        let cover_url = result.cover_url.expect("cover url should be found");
        assert!(cover_url.starts_with("https://ss.emu-land.net/"), "got: {cover_url}");
        assert_eq!(result.player_mode.as_deref(), Some("coop"), "got: {:?}", result.player_mode);
    }

    #[tokio::test]
    #[ignore]
    async fn downloads_real_cover_image() {
        let result = fetch_metadata("Contra").await.expect("scrape should succeed");
        let cover_url = result.cover_url.expect("cover url should be found");
        let bytes = download_image(&cover_url).await.expect("download should succeed");
        assert!(!bytes.is_empty());
    }
}
