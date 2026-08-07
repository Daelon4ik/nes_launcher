//! Второй транспорт кооп-сессии — P2P через Steam (ISteamNetworkingMessages),
//! вместо LAN-обнаружения и сырого TCP (см. discovery.rs/session.rs). Протокол
//! (NetplayMessage) и набор эмитируемых Tauri-событий (netplay://client-connected,
//! netplay://remote-input, netplay://peer-disconnected) — те же самые, что у LAN,
//! так что фронтенд (src/netplay/engine.ts, api/netplay.ts) не завязан на
//! конкретный транспорт. См. docs/netplay.md.
//!
//! AppID 480 — Spacewar, официальный тестовый AppID Steamworks SDK. Не требует
//! регистрации собственного AppID; используется здесь ровно так же, как в
//! собственном примере крейта `steamworks` (examples/networking-messages).
//! Даёт NAT traversal через Steam Relay — в отличие от LAN, работает через
//! интернет, а не только в одной сети. Матчмейкинга/лобби нет: игроки вручную
//! обмениваются Steam ID (см. Netplay Lobby Screen, вкладка «Через Steam»).
use super::{NetplayMessage, PeerInfo, SteamNetplayState};
use std::sync::Mutex;
use std::time::Duration;
use steamworks::networking_types::{NetworkingIdentity, SendFlags};
use steamworks::{Client, SteamId};
use tauri::{AppHandle, Emitter, Manager};

pub const STEAM_APP_ID: u32 = 480;

/// ~120 опросов/сек — с запасом выше кадровой частоты эмулятора (60к/с), чтобы
/// опрос колбэков/сообщений не становился узким местом задержки ввода.
const POLL_INTERVAL: Duration = Duration::from_millis(8);
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);

/// Инициализирует Steam-клиента при первом использовании (не при старте
/// приложения — не все пользователи используют кооп через Steam) и кэширует
/// его в состоянии; повторные вызовы просто клонируют уже готового клиента
/// (Client — Send+Sync+Clone, дешёвый Arc внутри).
pub fn ensure_client(state: &Mutex<SteamNetplayState>) -> Result<Client, String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    if let Some(client) = &guard.client {
        return Ok(client.clone());
    }
    let client = Client::init_app(STEAM_APP_ID)
        .map_err(|e| format!("Не удалось подключиться к Steam: {e}. Убедитесь, что Steam запущен и вы вошли в аккаунт."))?;
    guard.client = Some(client.clone());
    Ok(client)
}

pub fn local_steam_id(client: &Client) -> String {
    client.user().steam_id().raw().to_string()
}

pub fn parse_peer_id(raw: &str) -> Result<SteamId, String> {
    raw.trim()
        .parse::<u64>()
        .map(SteamId::from_raw)
        .map_err(|_| "Некорректный Steam ID — ожидается число (например, 76561198000000000)".to_string())
}

/// Принимать любую входящую сессию — как TCP accept(), реальная проверка
/// доверия происходит по чек-сумме ROM при рукопожатии (см. run_host), а не
/// на этом уровне. session_failed_callback — сетевой аналог обрыва TCP-сокета
/// (в отличие от нашего явного Disconnect-сообщения): о разрыве сессии в
/// любом случае эмитим один и тот же netplay://peer-disconnected.
pub fn install_callbacks(app: &AppHandle, client: &Client) {
    let messages = client.networking_messages();
    messages.session_request_callback(|request| {
        request.accept();
    });
    let app_for_failure = app.clone();
    messages.session_failed_callback(move |_info| {
        let _ = app_for_failure.emit("netplay://peer-disconnected", ());
    });
}

/// Запускает хостинг: спавнит фоновую задачу, которая ждёт Handshake от
/// любого пира, сверяет чек-сумму ROM и отвечает HandshakeAck — при успехе
/// эмитит netplay://client-connected и переходит в режим ретрансляции ввода
/// (relay_loop), при неуспехе — просто отвечает отказом и продолжает ждать
/// следующую попытку (тот же принцип, что у accept_and_handshake в session.rs:
/// один случайный/ошибочный пир не должен убивать хостинг).
pub fn start_hosting(
    app: AppHandle,
    state: &Mutex<SteamNetplayState>,
    display_name: String,
    rom_checksum: String,
) -> Result<(), String> {
    let client = ensure_client(state)?;
    install_callbacks(&app, &client);

    let mut guard = state.lock().map_err(|e| e.to_string())?;
    guard.clear_session(); // повторный вызов не должен плодить задачи
    guard.pump_task = Some(tauri::async_runtime::spawn(run_host(
        app,
        client,
        display_name,
        rom_checksum,
    )));
    Ok(())
}

async fn run_host(app: AppHandle, client: Client, own_display_name: String, expected_checksum: String) {
    let messages = client.networking_messages();

    let peer = loop {
        client.run_callbacks();

        let mut accepted: Option<SteamId> = None;
        for message in messages.receive_messages_on_channel(0, 32) {
            let Some(peer_id) = message.identity_peer().steam_id() else { continue };
            let Ok(NetplayMessage::Handshake { display_name, rom_checksum }) =
                serde_json::from_slice::<NetplayMessage>(message.data())
            else {
                continue;
            };

            let ok = rom_checksum == expected_checksum;
            let ack = NetplayMessage::HandshakeAck {
                display_name: own_display_name.clone(),
                ok,
                reason: if ok { None } else { Some("ROM не совпадает у хоста и клиента".to_string()) },
            };
            if let Ok(data) = serde_json::to_vec(&ack) {
                let _ = messages.send_message_to_user(
                    NetworkingIdentity::new_steam_id(peer_id),
                    SendFlags::RELIABLE,
                    &data,
                    0,
                );
            }

            if ok {
                if let Some(steam_state) = app.try_state::<Mutex<SteamNetplayState>>() {
                    if let Ok(mut guard) = steam_state.lock() {
                        guard.peer = Some(peer_id);
                    }
                }
                let _ = app.emit("netplay://client-connected", PeerInfo { display_name });
                accepted = Some(peer_id);
                break;
            }
        }

        if let Some(peer_id) = accepted {
            break peer_id;
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    };

    relay_loop(&app, &client, peer).await;
}

/// Подключается к хосту: шлёт Handshake на указанный SteamID и ждёт
/// HandshakeAck с таймаутом. В отличие от хостинга выполняется синхронно в
/// теле команды (а не в фоновой задаче) — результат нужен сразу, чтобы
/// зарезолвить промис на фронтенде (тот же принцип, что у connect_and_handshake
/// в session.rs для LAN).
pub async fn join(
    client: &Client,
    peer: SteamId,
    own_display_name: String,
    rom_checksum: String,
) -> Result<PeerInfo, String> {
    let messages = client.networking_messages();
    let handshake = NetplayMessage::Handshake { display_name: own_display_name, rom_checksum };
    let data = serde_json::to_vec(&handshake).map_err(|e| e.to_string())?;
    messages
        .send_message_to_user(NetworkingIdentity::new_steam_id(peer), SendFlags::RELIABLE, &data, 0)
        .map_err(|e| format!("Не удалось отправить рукопожатие: {e:?}"))?;

    let deadline = tokio::time::Instant::now() + HANDSHAKE_TIMEOUT;
    loop {
        client.run_callbacks();

        for message in messages.receive_messages_on_channel(0, 32) {
            if message.identity_peer().steam_id() != Some(peer) {
                continue;
            }
            if let Ok(NetplayMessage::HandshakeAck { display_name, ok, reason }) =
                serde_json::from_slice::<NetplayMessage>(message.data())
            {
                if ok {
                    return Ok(PeerInfo { display_name });
                }
                return Err(reason.unwrap_or_else(|| "Хост отклонил подключение".to_string()));
            }
        }

        if tokio::time::Instant::now() >= deadline {
            return Err("Хост не ответил рукопожатием (тайм-аут) — проверьте Steam ID и убедитесь, что хост уже запустил кооп".to_string());
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }
}

/// Ретрансляция ввода партнёра в Tauri-события после установленной сессии —
/// общая для хоста и клиента (запускается фоновой задачей у обоих после
/// успешного рукопожатия). Завершается сама, когда партнёр явно прислал
/// Disconnect; при обрыве сессии без явного сообщения — см.
/// session_failed_callback в install_callbacks (эмитит то же событие
/// независимо от этого цикла).
async fn relay_loop(app: &AppHandle, client: &Client, peer: SteamId) {
    let messages = client.networking_messages();
    loop {
        client.run_callbacks();

        for message in messages.receive_messages_on_channel(0, 32) {
            if message.identity_peer().steam_id() != Some(peer) {
                continue;
            }
            match serde_json::from_slice::<NetplayMessage>(message.data()) {
                Ok(NetplayMessage::Input { frame, buttons }) => {
                    let _ = app.emit(
                        "netplay://remote-input",
                        serde_json::json!({ "frame": frame, "buttons": buttons }),
                    );
                }
                Ok(NetplayMessage::Disconnect) => {
                    let _ = app.emit("netplay://peer-disconnected", ());
                    return;
                }
                _ => {} // Handshake/-Ack тут не ожидаются вне рукопожатия — игнорируем
            }
        }

        tokio::time::sleep(POLL_INTERVAL).await;
    }
}

/// Спавнит фоновую задачу ретрансляции для уже установленной (после join)
/// сессии — вызывается из commands::steam_netplay после успешного
/// рукопожатия, тем же способом, что и хостинг регистрирует свою задачу.
pub fn spawn_relay(app: AppHandle, state: &Mutex<SteamNetplayState>, client: Client, peer: SteamId) -> Result<(), String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    guard.clear_session();
    guard.peer = Some(peer);
    guard.pump_task = Some(tauri::async_runtime::spawn(async move {
        relay_loop(&app, &client, peer).await;
    }));
    Ok(())
}

/// Явный выход из кооп-сессии — уведомляет партнёра best-effort и сразу
/// освобождает состояние (та же логика, что netplay_disconnect у LAN).
pub fn disconnect(state: &Mutex<SteamNetplayState>) -> Result<(), String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    if let (Some(client), Some(peer)) = (&guard.client, guard.peer) {
        if let Ok(data) = serde_json::to_vec(&NetplayMessage::Disconnect) {
            let _ = client.networking_messages().send_message_to_user(
                NetworkingIdentity::new_steam_id(peer),
                SendFlags::RELIABLE,
                &data,
                0,
            );
        }
    }
    guard.clear_session();
    Ok(())
}

/// Отправляет состояние кнопок за кадр партнёру — вызывается ~60 раз/сек из
/// игрового цикла (см. src/netplay/engine.ts), не блокирующий вызов
/// (send_message_to_user не ждёт подтверждения доставки).
pub fn send_input(state: &Mutex<SteamNetplayState>, frame: u32, buttons: u8) -> Result<(), String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    let (Some(client), Some(peer)) = (&guard.client, guard.peer) else {
        return Err("Нет активной Steam-сессии".to_string());
    };
    let data = serde_json::to_vec(&NetplayMessage::Input { frame, buttons }).map_err(|e| e.to_string())?;
    client
        .networking_messages()
        .send_message_to_user(NetworkingIdentity::new_steam_id(peer), SendFlags::RELIABLE, &data, 0)
        .map_err(|e| format!("{e:?}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_valid_and_rejects_invalid_steam_id() {
        assert_eq!(parse_peer_id("76561198216389833").unwrap().raw(), 76561198216389833);
        assert!(parse_peer_id("не число").is_err());
        assert!(parse_peer_id("").is_err());
    }

    // Реальное подключение к работающему Steam-клиенту — не входит в обычный
    // `cargo test`, только `cargo test -- --ignored` (нужен запущенный Steam
    // и LD_LIBRARY_PATH, указывающий на вендоренный libsteam_api.so — см.
    // docs/netplay.md).
    #[test]
    #[ignore]
    fn connects_to_running_steam_client() {
        let client = Client::init_app(STEAM_APP_ID).expect("Steam client should be running for this test");
        let id = local_steam_id(&client);
        assert!(!id.is_empty() && id != "0", "got: {id}");
    }
}
