# NES Launcher

Десктопное приложение-лаунчер для игр NES: библиотека ROM'ов, загрузка метаданных и обложек, встроенный эмулятор и отслеживание прогресса игр.

## Стек

- **Backend**: [Tauri](https://tauri.app/) (Rust) — файловая система, база данных, системные вызовы
- **Frontend**: React + TypeScript
- **Эмулятор**: встроенный, работает в webview (например, на базе jsnes/wasm-ядра)
- **Хранилище**: SQLite (библиотека игр, сохранения, статистика)

## Документация

- [Архитектура](docs/architecture.md)
- [Экраны и UI](docs/screens.md)
- [Внешний вид](docs/design.md)
- [Модель данных](docs/data-model.md)
- [Roadmap](docs/roadmap.md)

## Структура проекта

```
nes_launhder/
├── docs/                  # документация проекта
├── src-tauri/              # backend на Rust (Tauri)
│   └── src/
│       ├── commands/        # IPC-команды, вызываемые из фронтенда
│       ├── db/               # работа с SQLite
│       └── metadata/         # скачивание метаданных/обложек игр
└── src/                    # frontend на React + TypeScript
    ├── screens/              # экраны приложения (Main, Settings, Emulator)
    ├── components/           # переиспользуемые UI-компоненты
    ├── hooks/                # React-хуки
    ├── store/                # состояние приложения
    ├── api/                  # обёртки над Tauri invoke
    └── types/                # общие TypeScript-типы
```

## Разработка

Проект ещё не проинициализирован как реальное Tauri-приложение — сейчас это только структура и документация. Для старта разработки:

```bash
npm create tauri-app@latest .
```

и последующим переносом уже созданных папок (`src`, `src-tauri`) в сгенерированный проект.
