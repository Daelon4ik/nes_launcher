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
| player_mode | TEXT | `"single"` \| `"alternating"` \| `"coop"`. По умолчанию `"single"`, уточняется полем «Игроки» со страницы игры на emu-land.net (тем же скрапером, что тянет description/cover_path) |
| platform | TEXT | **Планируется** (см. [platforms.md](platforms.md)) — `"nes"` \| `"genesis"`, по расширению файла (`.nes`/`.gen`) в момент добавления в библиотеку. По умолчанию `"nes"` для уже существующих записей (миграция по образцу `player_mode`, `add_column_if_missing`) |

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
| file_path | TEXT | Путь к файлу снимка — `<app-data>/saves/<game_id>/slot_<slot>.json`. Формат содержимого зависит от платформы игры и непрозрачен для бэкенда (он просто хранит переданную строку файлом): для NES — JSON от `nes.toJSON()`, для Genesis — base64 от бинарного `retro_serialize`-блоба ядра (см. [platforms.md](platforms.md#save-state-реализовано)); имя файла всегда `.json` независимо от платформы, менять не стали |
| created_at | DATETIME | |

Уникальный индекс по `(game_id, slot)` — сохранение в занятый слот перезаписывает запись (`ON CONFLICT DO UPDATE`), а не плодит дубликаты.

## Settings

Простая key-value таблица (`src-tauri/src/db/mod.rs`): `settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)`. Значение всегда строка — числовые/булевы настройки сериализуются в текст на границе backend-команды (`src-tauri/src/commands/settings.rs`), а не хранятся типизированно в БД.

| Ключ | Пример значения | Описание |
|---|---|---|
| rom_library_paths | `["/home/user/roms/nes"]` | Папки, которые сканируются на ROM'ы (JSON-массив строкой). Вкладка «Библиотека» |
| theme | `"light" \| "dark" \| "system"` | Тема оформления. Вкладка «Лаунчер» |
| volume | `"1"` | Громкость эмулятора, `0.0`–`1.0` строкой. Вкладка «Эмулятор», по умолчанию `1.0` |
| network_display_name | `"Игрок"` | Имя, видимое партнёру в P2P-коопе. Вкладка «Сеть», см. [netplay.md](netplay.md) |
| network_host_port | `"7777"` | TCP-порт, на котором лаунчер слушает входящее подключение в режиме хоста. Вкладка «Сеть» |

Раскладка управления (клавиатура/геймпад) в эту таблицу **не** попадает — хранится отдельно, во фронтендовом `localStorage` (`keyboard_controls`, `gamepad_controls`, см. [screens.md](screens.md#2-settings-screen)), не в SQLite. Источник метаданных (`emu-land.net`) не настраиваемый — захардкожен в `metadata/scraper.rs`, тоже не хранится как Setting.

**Планируется** (см. [platforms.md](platforms.md#контроллер)): ключи раскладки управления в `localStorage` получат платформенный неймспейс (`keyboard_controls_nes`/`keyboard_controls_genesis` и т.п.) вместо текущих плоских `keyboard_controls`/`gamepad_controls`.

Версия лаунчера в настройках не хранится в БД — читается из `package.json` / `Cargo.toml` (`tauri::generate_context!().package_info()`) и выводится только для отображения.
