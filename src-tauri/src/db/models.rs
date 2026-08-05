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
}

/// См. docs/data-model.md#SaveState. camelCase — соответствует src/api/saves.ts на фронтенде.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSlot {
    pub slot: i64,
    pub created_at: Option<String>,
}
