use serde::{Deserialize, Serialize};

/// См. docs/data-model.md. camelCase — соответствует src/types/game.ts на фронтенде.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Game {
    pub id: i64,
    pub title: String,
    pub rom_path: String,
    pub description: Option<String>,
    pub cover_path: Option<String>,
    pub last_played_at: Option<String>,
    pub total_playtime_seconds: i64,
    pub added_at: String,
    /// "single" | "alternating" | "coop" — см. `metadata::scraper::parse_player_mode`.
    pub player_mode: String,
}
