# NES Launcher

Десктопное приложение-лаунчер для игр NES: библиотека ROM'ов, загрузка метаданных и обложек, встроенный эмулятор и отслеживание прогресса игр.

## Стек

- **Backend**: [Tauri](https://tauri.app/) (Rust) — файловая система, база данных, системные вызовы
- **Frontend**: React + TypeScript
- **Эмулятор**: встроенный, на базе [jsnes](https://github.com/bfirsh/jsnes) (canvas + Web Audio, работает прямо в webview)
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

```bash
npm install        # один раз
npm run tauri dev  # настоящее окно лаунчера (Rust + webview)
```

Или только фронтенд в браузере для быстрой проверки вёрстки (данные библиотеки не подтянутся — нет Tauri IPC вне десктоп-окна):

```bash
npm run dev  # http://localhost:1420
```

**Hyprland/Wayland:** нативный GTK-бэкенд `tao` под Hyprland у части пользователей завершает процесс мгновенно и без ошибок (окно не открывается, exit code 0, лог обрывается на строке `Running`). Обходится принудительным запуском через XWayland:

```bash
GDK_BACKEND=x11 npm run tauri dev
```
