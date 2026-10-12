pub mod discovery;
pub mod session;
pub mod steam;

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::async_runtime::JoinHandle;
use tokio::sync::mpsc;

/// UDP-порт для LAN-обнаружения хостов кооп-сессий. Отдельный от TCP-порта
/// хоста (тот настраивается пользователем) — фиксирован, чтобы клиент знал,
/// куда слушать broadcast, не зная заранее порт хоста. См. docs/netplay.md.
pub const DISCOVERY_PORT: u16 = 47998;

/// Версия сетевого протокола — сверяется при рукопожатии, чтобы партнёр на
/// другой версии лаунчера получил понятную ошибку в лобби, а не молча
/// зависшую игру. У старых версий поля нет вовсе (serde default → 0).
/// 2 — InputPacket с окном неподтверждённых кадров вместо Input на кадр.
pub const PROTOCOL_VERSION: u32 = 2;

pub const VERSION_MISMATCH: &str = "У партнёра другая версия лаунчера — обновите dlemu у обоих игроков";

/// Сообщения кооп-сессии (общие для LAN и Steam). Формат на проводе — JSON
/// (у LAN — newline-delimited, см. session.rs) — трафик тут крошечный (один
/// пакет ввода на кадр, ~60 раз/сек на игрока), так что читаемость JSON
/// важнее компактности бинарного протокола.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum NetplayMessage {
    Handshake {
        display_name: String,
        rom_checksum: String,
        #[serde(default)]
        protocol: u32,
    },
    HandshakeAck {
        display_name: String,
        ok: bool,
        reason: Option<String>,
        #[serde(default)]
        protocol: u32,
    },
    Inputs(InputPacket),
    Disconnect,
}

/// Пакет ввода — формирует и разбирает фронтенд (src/netplay/lockstep.ts),
/// Rust только пересылает его как есть и реэмитит партнёру событием
/// `netplay://remote-input`. Несёт ВСЕ ещё не подтверждённые партнёром кадры,
/// поэтому отдельный пакет можно потерять (Steam шлёт их ненадёжно, см. steam.rs).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InputPacket {
    /// Номер кадра первого элемента `buttons`.
    pub first: u32,
    /// Состояние кнопок отправителя за кадры first.., по байту на кадр.
    pub buttons: Vec<u8>,
    /// Отправитель знает ввод получателя за все кадры < ack.
    pub ack: u32,
    /// Запас отправителя по времени в кадрах — для выравнивания темпа сторон.
    pub margin: f32,
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

/// Фоновый поток Steam-сессии (см. steam.rs): качает run_callbacks() и
/// входящие сообщения. Именно поток ОС, а не tokio-задача: таймер tokio на
/// Windows тикает с разрешением системного таймера (~15.6 мс), и опрос «раз
/// в 8 мс» фактически давал до 15.6 мс задержки и джиттера на каждый пакет
/// ввода. Останавливается флагом при drop (без join — поток сам выходит за
/// ~1 мс, а ждать его под мьютексом состояния значило бы рисковать дедлоком).
pub struct SteamPump {
    stop: Arc<AtomicBool>,
}

impl SteamPump {
    pub fn spawn(body: impl FnOnce(Arc<AtomicBool>) + Send + 'static) -> Result<Self, String> {
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        std::thread::Builder::new()
            .name("steam-netplay".to_string())
            .spawn(move || body(flag))
            .map_err(|e| format!("Не удалось запустить сетевой поток: {e}"))?;
        Ok(Self { stop })
    }
}

impl Drop for SteamPump {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
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
    /// Фоновый поток, качающий run_callbacks() + ретранслирующий входящие
    /// пакеты ввода/Disconnect в Tauri-события, пока сессия активна.
    pub pump: Option<SteamPump>,
    pub peer: Option<steamworks::SteamId>,
}

impl SteamNetplayState {
    pub fn clear_session(&mut self) {
        self.pump = None; // drop останавливает поток
        self.peer = None;
    }
}
