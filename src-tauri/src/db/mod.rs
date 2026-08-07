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
        added_at TEXT NOT NULL,
        player_mode TEXT NOT NULL DEFAULT 'single',
        favorite INTEGER NOT NULL DEFAULT 0
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

    CREATE UNIQUE INDEX IF NOT EXISTS idx_save_state_game_slot ON save_state(game_id, slot);

    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
";

/// Открывает соединение с SQLite и применяет схему из docs/data-model.md.
pub fn init(db_path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(db_path)?;
    conn.execute_batch(SCHEMA)?;
    // `CREATE TABLE IF NOT EXISTS` не добавляет колонки в уже существующую таблицу —
    // для баз, созданных до появления player_mode, нужен отдельный ALTER TABLE.
    add_column_if_missing(&conn, "game", "player_mode", "TEXT NOT NULL DEFAULT 'single'")?;
    add_column_if_missing(&conn, "game", "favorite", "INTEGER NOT NULL DEFAULT 0")?;
    Ok(conn)
}

fn add_column_if_missing(conn: &Connection, table: &str, column: &str, ddl: &str) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let has_column = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .filter_map(Result::ok)
        .any(|name| name == column);
    if !has_column {
        conn.execute(&format!("ALTER TABLE {table} ADD COLUMN {column} {ddl}"), [])?;
    }
    Ok(())
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
        player_mode: row.get(8)?,
        favorite: row.get::<_, i64>(9)? != 0,
    })
}

const GAME_COLUMNS: &str = "id, title, rom_path, description, cover_path, last_played_at, total_playtime_seconds, added_at, player_mode, favorite";

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

/// Обратный поиск к game_rom_path — используется в commands::store сразу после
/// insert_game_if_missing, чтобы узнать id только что установленной из магазина игры
/// (сама insert_game_if_missing его не возвращает — INSERT OR IGNORE, id не всегда
/// свежий rowid, если запись уже существовала).
pub fn game_id_by_rom_path(conn: &Connection, rom_path: &str) -> rusqlite::Result<Option<i64>> {
    conn.query_row(
        "SELECT id FROM game WHERE rom_path = ?1",
        params![rom_path],
        |row| row.get(0),
    )
    .optional()
}

/// Меняет title/rom_path у уже существующей записи — используется при замене версии
/// игры из магазина (см. commands::store::store_install с replace_game_id): та же
/// запись (и её история play_session/save_state) сохраняется, меняется только то,
/// какой физический файл за ней стоит.
pub fn update_game_rom(conn: &Connection, game_id: i64, title: &str, rom_path: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE game SET title = ?1, rom_path = ?2 WHERE id = ?3",
        params![title, rom_path, game_id],
    )?;
    Ok(())
}

/// Удаляет игру и связанные с ней сессии/сохранения (нет ON DELETE CASCADE в схеме).
pub fn delete_game(conn: &Connection, game_id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM play_session WHERE game_id = ?1", params![game_id])?;
    conn.execute("DELETE FROM save_state WHERE game_id = ?1", params![game_id])?;
    conn.execute("DELETE FROM game WHERE id = ?1", params![game_id])?;
    Ok(())
}

pub fn get_game(conn: &Connection, game_id: i64) -> rusqlite::Result<Option<Game>> {
    conn.query_row(
        &format!("SELECT {GAME_COLUMNS} FROM game WHERE id = ?1"),
        params![game_id],
        row_to_game,
    )
    .optional()
}

/// Записывает результат скрапинга метаданных (поля могут быть не найдены по
/// отдельности — тогда соответствующее поле не трогаем).
pub fn update_game_metadata(
    conn: &Connection,
    game_id: i64,
    description: Option<&str>,
    cover_path: Option<&str>,
    player_mode: Option<&str>,
) -> rusqlite::Result<()> {
    if let Some(description) = description {
        conn.execute(
            "UPDATE game SET description = ?1 WHERE id = ?2",
            params![description, game_id],
        )?;
    }
    if let Some(cover_path) = cover_path {
        conn.execute(
            "UPDATE game SET cover_path = ?1 WHERE id = ?2",
            params![cover_path, game_id],
        )?;
    }
    if let Some(player_mode) = player_mode {
        conn.execute(
            "UPDATE game SET player_mode = ?1 WHERE id = ?2",
            params![player_mode, game_id],
        )?;
    }
    Ok(())
}

pub fn set_favorite(conn: &Connection, game_id: i64, favorite: bool) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE game SET favorite = ?1 WHERE id = ?2",
        params![favorite as i64, game_id],
    )?;
    Ok(())
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

/// Слоты сохранений игры, у которых уже есть файл (пустые слоты не хранятся в БД).
pub fn list_save_states(conn: &Connection, game_id: i64) -> rusqlite::Result<Vec<models::SaveSlot>> {
    let mut stmt = conn.prepare(
        "SELECT slot, created_at FROM save_state WHERE game_id = ?1 ORDER BY slot",
    )?;
    let rows = stmt
        .query_map(params![game_id], |row| {
            Ok(models::SaveSlot {
                slot: row.get(0)?,
                created_at: row.get(1)?,
            })
        })?
        .collect();
    rows
}

pub fn save_state_file_path(conn: &Connection, game_id: i64, slot: i64) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT file_path FROM save_state WHERE game_id = ?1 AND slot = ?2",
        params![game_id, slot],
        |row| row.get(0),
    )
    .optional()
}

/// Записывает слот сохранения — перезаписывает существующий файл того же слота, если он уже был.
pub fn upsert_save_state(
    conn: &Connection,
    game_id: i64,
    slot: i64,
    file_path: &str,
    created_at: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO save_state (game_id, slot, file_path, created_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(game_id, slot) DO UPDATE SET file_path = excluded.file_path, created_at = excluded.created_at",
        params![game_id, slot, file_path, created_at],
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
        assert_eq!(games[0].player_mode, "single");
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
    fn game_id_by_rom_path_finds_inserted_game() {
        let conn = memory_db();
        insert_game_if_missing(&conn, "Contra", "/roms/contra.nes", "2026-01-01T00:00:00Z").unwrap();
        let id = conn.last_insert_rowid();
        assert_eq!(game_id_by_rom_path(&conn, "/roms/contra.nes").unwrap(), Some(id));
    }

    #[test]
    fn game_id_by_rom_path_returns_none_for_unknown_path() {
        let conn = memory_db();
        assert_eq!(game_id_by_rom_path(&conn, "/roms/unknown.nes").unwrap(), None);
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
    fn get_game_returns_none_for_unknown_id() {
        let conn = memory_db();
        assert!(get_game(&conn, 999).unwrap().is_none());
    }

    #[test]
    fn update_game_metadata_sets_description_and_cover() {
        let conn = memory_db();
        insert_game_if_missing(&conn, "Contra", "/roms/contra.nes", "2026-01-01T00:00:00Z").unwrap();
        let id = conn.last_insert_rowid();

        update_game_metadata(
            &conn,
            id,
            Some("Классика"),
            Some("https://example.com/cover.png"),
            Some("coop"),
        )
        .unwrap();

        let game = get_game(&conn, id).unwrap().unwrap();
        assert_eq!(game.description.as_deref(), Some("Классика"));
        assert_eq!(game.cover_path.as_deref(), Some("https://example.com/cover.png"));
        assert_eq!(game.player_mode, "coop");
    }

    #[test]
    fn update_game_metadata_leaves_field_untouched_when_none() {
        let conn = memory_db();
        insert_game_if_missing(&conn, "Contra", "/roms/contra.nes", "2026-01-01T00:00:00Z").unwrap();
        let id = conn.last_insert_rowid();

        update_game_metadata(&conn, id, Some("Классика"), None, None).unwrap();
        update_game_metadata(&conn, id, None, Some("https://example.com/cover.png"), None).unwrap();

        let game = get_game(&conn, id).unwrap().unwrap();
        assert_eq!(game.description.as_deref(), Some("Классика"));
        assert_eq!(game.cover_path.as_deref(), Some("https://example.com/cover.png"));
        assert_eq!(game.player_mode, "single");
    }

    #[test]
    fn set_favorite_toggles_flag() {
        let conn = memory_db();
        insert_game_if_missing(&conn, "Contra", "/roms/contra.nes", "2026-01-01T00:00:00Z").unwrap();
        let id = conn.last_insert_rowid();
        assert!(!get_game(&conn, id).unwrap().unwrap().favorite);

        set_favorite(&conn, id, true).unwrap();
        assert!(get_game(&conn, id).unwrap().unwrap().favorite);

        set_favorite(&conn, id, false).unwrap();
        assert!(!get_game(&conn, id).unwrap().unwrap().favorite);
    }

    #[test]
    fn delete_game_removes_game_and_related_rows() {
        let conn = memory_db();
        insert_game_if_missing(&conn, "Contra", "/roms/contra.nes", "2026-01-01T00:00:00Z").unwrap();
        let id = conn.last_insert_rowid();
        record_session(&conn, id, 90, "2026-01-02T00:00:00Z", "2026-01-02T00:01:30Z").unwrap();

        delete_game(&conn, id).unwrap();

        assert!(get_game(&conn, id).unwrap().is_none());
        let session_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM play_session WHERE game_id = ?1", params![id], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(session_count, 0);
    }

    #[test]
    fn init_adds_player_mode_column_to_pre_existing_db_file() {
        let path = std::env::temp_dir().join(format!("nes-launcher-test-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);

        {
            // Симулируем базу, созданную до появления player_mode.
            let old_schema = SCHEMA.replace(",\n        player_mode TEXT NOT NULL DEFAULT 'single'", "");
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(&old_schema).unwrap();
            insert_game_if_missing(&conn, "Contra", "/roms/contra.nes", "2026-01-01T00:00:00Z").unwrap();
        }

        let conn = init(&path).unwrap();
        let games = list_games(&conn).unwrap();
        assert_eq!(games[0].player_mode, "single");

        drop(conn);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn upsert_save_state_overwrites_same_slot() {
        let conn = memory_db();
        insert_game_if_missing(&conn, "Contra", "/roms/contra.nes", "2026-01-01T00:00:00Z").unwrap();
        let id = conn.last_insert_rowid();

        upsert_save_state(&conn, id, 1, "/saves/1/slot_1.json", "2026-01-01T00:00:00Z").unwrap();
        upsert_save_state(&conn, id, 1, "/saves/1/slot_1_new.json", "2026-01-02T00:00:00Z").unwrap();

        let slots = list_save_states(&conn, id).unwrap();
        assert_eq!(slots.len(), 1);
        assert_eq!(slots[0].slot, 1);
        assert_eq!(slots[0].created_at, Some("2026-01-02T00:00:00Z".to_string()));
        assert_eq!(
            save_state_file_path(&conn, id, 1).unwrap(),
            Some("/saves/1/slot_1_new.json".to_string())
        );
    }

    #[test]
    fn save_state_file_path_returns_none_for_empty_slot() {
        let conn = memory_db();
        insert_game_if_missing(&conn, "Contra", "/roms/contra.nes", "2026-01-01T00:00:00Z").unwrap();
        let id = conn.last_insert_rowid();

        assert_eq!(save_state_file_path(&conn, id, 1).unwrap(), None);
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
