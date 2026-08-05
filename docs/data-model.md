# Модель данных

Хранилище: SQLite, доступ из `src-tauri/src/db`.

## Game

| Поле | Тип | Описание |
|---|---|---|
| id | INTEGER PK | |
| title | TEXT | Название игры |
| rom_path | TEXT | Путь к файлу ROM на диске |
| description | TEXT | Описание, полученное из metadata scraper'а |
| cover_path | TEXT | Путь к локально скачанной обложке (`<app-data>/covers/<id>.<ext>`). Отдавать URL emu-land.net напрямую в webview нельзя — сервер блокирует хотлинки по Referer (403), поэтому картинка скачивается бэкендом и грузится в UI через `convertFileSrc` (asset protocol) |
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
| slot | INTEGER | Номер слота сохранения (1..3, см. `Emulator Screen` в [screens.md](screens.md)) |
| file_path | TEXT | Путь к JSON-файлу `nes.toJSON()` — `<app-data>/saves/<game_id>/slot_<slot>.json` |
| created_at | DATETIME | |

Уникальный индекс по `(game_id, slot)` — сохранение в занятый слот перезаписывает запись (`ON CONFLICT DO UPDATE`), а не плодит дубликаты.

## Settings

Хранится как key-value или отдельная таблица с одной строкой (пока не определено окончательно).

| Ключ | Пример значения | Описание |
|---|---|---|
| rom_library_paths | `["/home/user/roms/nes"]` | Папки, которые сканируются на ROM'ы |
| metadata_source | `"emu-land.net"` | Источник метаданных/обложек — https://www.emu-land.net/consoles/dendy/roms |
| controls | `{ "p1": {...} }` | Раскладка управления |
| theme | `"light" \| "dark" \| "system"` | Тема оформления (вкладка «Лаунчер») |
| network_display_name | `"Игрок"` | Имя, видимое партнёру в P2P-коопе (вкладка «Сеть», см. [netplay.md](netplay.md)) |
| network_host_port | `"7777"` | TCP-порт, на котором лаунчер слушает входящее подключение в режиме хоста |

Версия лаунчера в настройках не хранится в БД — читается из `package.json` / `Cargo.toml` (`tauri::generate_context!().package_info()`) и выводится только для отображения.
