pub mod discovery;
pub mod session;
pub mod steam;

use serde::{Deserialize, Serialize};
use tauri::async_runtime::JoinHandle;
use tokio::sync::mpsc;

/// UDP-порт для LAN-обнаружения хостов кооп-сессий. Отдельный от TCP-порта
/// хоста (тот настраивается пользователем) — фиксирован, чтобы клиент знал,
/// куда слушать broadcast, не зная заранее порт хоста. См. docs/netplay.md.
pub const DISCOVERY_PORT: u16 = 47998;

/// Сообщения TCP-сессии кооп-игры. Формат на проводе — newline-delimited JSON
/// (см. session.rs) — трафик тут крошечный (1 Input-сообщение на кадр,
/// ~60 раз/сек на игрока), так что читаемость JSON важнее компактности
/// бинарного протокола.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum NetplayMessage {
    Handshake { display_name: String, rom_checksum: String },
    HandshakeAck { display_name: String, ok: bool, reason: Option<String> },
    Input { frame: u32, buttons: u8 },
    Disconnect,
}

/// UDP-анонс хоста для LAN-обнаружения (см. discovery.rs).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HostAnnounce {
    pub display_name: String,
    pub game_title: String,
    pub rom_checksum: String,
    pub tcp_port: u16,
}

/// Результат успешного подключения — то, что фронтенд узнаёт о партнёре.
/// camelCase — соответствует src/types/netplay.ts на фронтенде.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerInfo {
    pub display_name: String,
}

/// Активная TCP-сессия кооп-игры: канал для исходящих сообщений (пишет их
/// отдельная writer-задача, чтобы command-обработчики не блокировались на
/// сокете) + хэндл читающей задачи (эмитит события по мере прихода сообщений).
pub struct SessionHandle {
    pub outgoing_tx: mpsc::UnboundedSender<NetplayMessage>,
    pub reader_task: JoinHandle<()>,
}

/// Управляемое Tauri-состояние сетевого модуля. Ровно одна активная сессия
/// одновременно (кооп — всегда два игрока), плюс фоновые задачи обнаружения/
/// хостинга, которые существуют только до момента подключения.
#[derive(Default)]
pub struct NetplayState {
    pub discovery_task: Option<JoinHandle<()>>,
    pub hosting_broadcast_task: Option<JoinHandle<()>>,
    pub hosting_accept_task: Option<JoinHandle<()>>,
    pub session: Option<SessionHandle>,
}

impl NetplayState {
    pub fn stop_discovery(&mut self) {
        if let Some(task) = self.discovery_task.take() {
            task.abort();
        }
    }

    pub fn stop_hosting(&mut self) {
        if let Some(task) = self.hosting_broadcast_task.take() {
            task.abort();
        }
        if let Some(task) = self.hosting_accept_task.take() {
            task.abort();
        }
    }

    pub fn clear_session(&mut self) {
        if let Some(session) = self.session.take() {
            session.reader_task.abort();
        }
    }
}

/// Управляемое Tauri-состояние Steam-транспорта кооп-сессии (см. steam.rs) —
/// второй, независимый от LAN способ подключения, тот же протокол
/// (NetplayMessage), тот же набор Tauri-событий (netplay://...), другой
/// транспорт (ISteamNetworkingMessages вместо TCP). См. docs/netplay.md.
#[derive(Default)]
pub struct SteamNetplayState {
    /// Ленивая инициализация — только при первом использовании фичи, не при
    /// старте приложения, чтобы не тянуть зависимость от Steam для тех, кто
    /// эту фичу не трогает.
    pub client: Option<steamworks::Client>,
    /// Фоновая задача, качающая run_callbacks() + ретранслирующая входящие
    /// Input/Disconnect сообщения в Tauri-события, пока сессия активна.
    pub pump_task: Option<JoinHandle<()>>,
    pub peer: Option<steamworks::SteamId>,
}

impl SteamNetplayState {
    pub fn clear_session(&mut self) {
        if let Some(task) = self.pump_task.take() {
            task.abort();
        }
        self.peer = None;
    }
}
