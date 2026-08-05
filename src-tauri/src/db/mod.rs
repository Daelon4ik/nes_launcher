pub mod models;

use models::Game;
use rusqlite::{Connection, OptionalExtension, params};
use std::path::Path;

const SCHEMA: &str = "
    CREATE TABLE IF NOT EXISTS game (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        rom_path TEXT NOT NULL UNIQUE,
        description TEXT,
        cover_path TEXT,
        last_played_at TEXT,
        total_playtime_seconds INTEGER NOT NULL DEFAULT 0,
        added_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS play_session (
        id INTEGER PRIMARY KEY,
        game_id INTEGER NOT NULL REFERENCES game(id),
        started_at TEXT NOT NULL,
        ended_at TEXT
    );

    CREATE TABLE IF NOT EXISTS save_state (
        id INTEGER PRIMARY KEY,
        game_id INTEGER NOT NULL REFERENCES game(id),
        slot INTEGER NOT NULL,
        file_path TEXT NOT NULL,
        created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
";

/// Открывает соединение с SQLite и применяет схему из docs/data-model.md.
pub fn init(db_path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(db_path)?;
    conn.execute_batch(SCHEMA)?;
    Ok(conn)
}

fn row_to_game(row: &rusqlite::Row) -> rusqlite::Result<Game> {
    Ok(Game {
        id: row.get(0)?,
        title: row.get(1)?,
        rom_path: row.get(2)?,
        description: row.get(3)?,
        cover_path: row.get(4)?,
        last_played_at: row.get(5)?,
        total_playtime_seconds: row.get(6)?,
        added_at: row.get(7)?,
    })
}

const GAME_COLUMNS: &str =
    "id, title, rom_path, description, cover_path, last_played_at, total_playtime_seconds, added_at";

pub fn list_games(conn: &Connection) -> rusqlite::Result<Vec<Game>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {GAME_COLUMNS} FROM game ORDER BY title COLLATE NOCASE"
    ))?;
    let games = stmt.query_map([], row_to_game)?.collect();
    games
}

/// Добавляет игру, если такого rom_path ещё нет в библиотеке. Не трогает существующую запись.
pub fn insert_game_if_missing(
    conn: &Connection,
    title: &str,
    rom_path: &str,
    added_at: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO game (title, rom_path, added_at, total_playtime_seconds) VALUES (?1, ?2, ?3, 0)",
        params![title, rom_path, added_at],
    )?;
    Ok(())
}

pub fn game_rom_path(conn: &Connection, game_id: i64) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT rom_path FROM game WHERE id = ?1",
        params![game_id],
        |row| row.get(0),
    )
    .optional()
}

/// Записывает завершённую сессию и обновляет статистику игры.
pub fn record_session(
    conn: &Connection,
    game_id: i64,
    duration_seconds: i64,
    started_at: &str,
    ended_at: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO play_session (game_id, started_at, ended_at) VALUES (?1, ?2, ?3)",
        params![game_id, started_at, ended_at],
    )?;
    conn.execute(
        "UPDATE game SET total_playtime_seconds = total_playtime_seconds + ?1, last_played_at = ?2 WHERE id = ?3",
        params![duration_seconds, ended_at, game_id],
    )?;
    Ok(())
}

pub fn get_setting(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", params![key], |row| {
        row.get(0)
    })
    .optional()
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn
    }

    #[test]
    fn insert_and_list_games() {
        let conn = memory_db();
        insert_game_if_missing(&conn, "Contra", "/roms/contra.nes", "2026-01-01T00:00:00Z").unwrap();
        insert_game_if_missing(&conn, "Zelda", "/roms/zelda.nes", "2026-01-01T00:00:00Z").unwrap();

        let games = list_games(&conn).unwrap();
        assert_eq!(games.len(), 2);
        // ORDER BY title COLLATE NOCASE
        assert_eq!(games[0].title, "Contra");
        assert_eq!(games[1].title, "Zelda");
        assert_eq!(games[0].total_playtime_seconds, 0);
        assert!(games[0].last_played_at.is_none());
    }

    #[test]
    fn rescanning_does_not_duplicate_by_rom_path() {
        let conn = memory_db();
        insert_game_if_missing(&conn, "Contra", "/roms/contra.nes", "2026-01-01T00:00:00Z").unwrap();
        insert_game_if_missing(&conn, "Contra", "/roms/contra.nes", "2026-01-02T00:00:00Z").unwrap();

        let games = list_games(&conn).unwrap();
        assert_eq!(games.len(), 1);
    }

    #[test]
    fn game_rom_path_returns_none_for_unknown_id() {
        let conn = memory_db();
        assert_eq!(game_rom_path(&conn, 999).unwrap(), None);
    }

    #[test]
    fn game_rom_path_returns_path_for_known_id() {
        let conn = memory_db();
        insert_game_if_missing(&conn, "Contra", "/roms/contra.nes", "2026-01-01T00:00:00Z").unwrap();
        let id = conn.last_insert_rowid();
        assert_eq!(game_rom_path(&conn, id).unwrap(), Some("/roms/contra.nes".to_string()));
    }

    #[test]
    fn record_session_updates_playtime_and_last_played() {
        let conn = memory_db();
        insert_game_if_missing(&conn, "Contra", "/roms/contra.nes", "2026-01-01T00:00:00Z").unwrap();
        let id = conn.last_insert_rowid();

        record_session(&conn, id, 90, "2026-01-02T00:00:00Z", "2026-01-02T00:01:30Z").unwrap();
        record_session(&conn, id, 60, "2026-01-03T00:00:00Z", "2026-01-03T00:01:00Z").unwrap();

        let games = list_games(&conn).unwrap();
        assert_eq!(games[0].total_playtime_seconds, 150);
        assert_eq!(games[0].last_played_at.as_deref(), Some("2026-01-03T00:01:00Z"));
    }

    #[test]
    fn get_setting_returns_none_when_missing() {
        let conn = memory_db();
        assert_eq!(get_setting(&conn, "rom_library_paths").unwrap(), None);
    }

    #[test]
    fn set_setting_upserts_value() {
        let conn = memory_db();
        set_setting(&conn, "theme", "dark").unwrap();
        assert_eq!(get_setting(&conn, "theme").unwrap(), Some("dark".to_string()));

        set_setting(&conn, "theme", "light").unwrap();
        assert_eq!(get_setting(&conn, "theme").unwrap(), Some("light".to_string()));
    }
}
