/// Источник метаданных и обложек игр — раздел Dendy/NES на emu-land.net.
const METADATA_SOURCE_URL: &str = "https://www.emu-land.net/consoles/dendy/roms";

/// Ищет описание и обложку игры по названию ROM, парся страницу emu-land.net.
pub async fn fetch_metadata(rom_title: &str) -> Result<(), String> {
    todo!("парсинг страницы игры на emu-land.net (METADATA_SOURCE_URL) по названию ROM")
}
