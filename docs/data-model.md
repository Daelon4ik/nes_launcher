# Модель данных

Хранилище: SQLite, доступ из `src-tauri/src/db`.

## Game

| Поле | Тип | Описание |
|---|---|---|
| id | INTEGER PK | |
| title | TEXT | Название игры |
| rom_path | TEXT | Путь к файлу ROM на диске |
| description | TEXT | Описание, полученное из metadata scraper'а |
| cover_path | TEXT | Путь к загруженной обложке (локальный кэш) |
| last_played_at | DATETIME NULL | Дата последнего запуска |
| total_playtime_seconds | INTEGER | Суммарное время в игре |
| added_at | DATETIME | Дата добавления в библиотеку |

## PlaySession

| Поле | Тип | Описание |
|---|---|---|
| id | INTEGER PK | |
| game_id | INTEGER FK → Game | |
| started_at | DATETIME | |
| ended_at | DATETIME NULL | |

Используется для статистики и обновления `Game.last_played_at` / `total_playtime_seconds`.

## SaveState

| Поле | Тип | Описание |
|---|---|---|
| id | INTEGER PK | |
| game_id | INTEGER FK → Game | |
| slot | INTEGER | Номер слота сохранения |
| file_path | TEXT | Путь к файлу save state |
| created_at | DATETIME | |

## Settings

Хранится как key-value или отдельная таблица с одной строкой (пока не определено окончательно).

| Ключ | Пример значения | Описание |
|---|---|---|
| rom_library_paths | `["/home/user/roms/nes"]` | Папки, которые сканируются на ROM'ы |
| metadata_source | `"emu-land.net"` | Источник метаданных/обложек — https://www.emu-land.net/consoles/dendy/roms |
| controls | `{ "p1": {...} }` | Раскладка управления |
| theme | `"light" \| "dark" \| "system"` | Тема оформления (вкладка «Лаунчер») |

Версия лаунчера в настройках не хранится в БД — читается из `package.json` / `Cargo.toml` (`tauri::generate_context!().package_info()`) и выводится только для отображения.
