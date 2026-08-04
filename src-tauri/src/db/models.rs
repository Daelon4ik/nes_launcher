use serde::{Deserialize, Serialize};

/// См. docs/data-model.md
#[derive(Debug, Serialize, Deserialize)]
pub struct Game {
    pub id: i64,
    pub title: String,
    pub rom_path: String,
    pub description: Option<String>,
    pub cover_path: Option<String>,
    pub last_played_at: Option<String>,
    pub total_playtime_seconds: i64,
    pub added_at: String,
}
