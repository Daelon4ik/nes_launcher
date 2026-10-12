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
use super::session::{handshake_ack_result, handshake_rejection};
use super::{InputPacket, NetplayMessage, PeerInfo, SteamNetplayState, SteamPump, PROTOCOL_VERSION};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use steamworks::networking_types::{NetworkingIdentity, SendFlags};
use steamworks::{Client, SteamId};
use tauri::{AppHandle, Emitter, Manager};

pub const STEAM_APP_ID: u32 = 480;

/// Опрос, пока ждём рукопожатия, — тут задержка в несколько мс не важна.
const POLL_INTERVAL: Duration = Duration::from_millis(8);
/// Опрос во время игры: каждый мс ожидания здесь — прямая добавка к задержке
/// пакета ввода (а разброс — к джиттеру), поэтому ~1000 раз/сек; сами
/// вызовы дешёвые (пустая очередь — доли микросекунды).
const RELAY_POLL_INTERVAL: Duration = Duration::from_millis(1);
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);

/// Служебные сообщения (рукопожатие, Disconnect) — гарантированно и без
/// Nagle: по умолчанию SteamNetworkingSockets копит мелкие сообщения до ~5 мс,
/// чтобы склеить их в один пакет.
const CONTROL_SEND: SendFlags = SendFlags::RELIABLE_NO_NAGLE;
/// Пакеты ввода — НЕнадёжно и без Nagle: каждый несёт все ещё не
/// подтверждённые партнёром кадры (см. InputPacket), так что потеря одного
/// закрывается следующим через кадр. У reliable потеря означала бы ожидание
/// ретрансмита (≈ RTT) с блокировкой всех следующих сообщений — то есть
/// стойку обеих сторон на каждый потерянный пакет.
const INPUT_SEND: SendFlags = SendFlags::UNRELIABLE_NO_NAGLE;

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
    guard.clear_session(); // повторный вызов не должен плодить потоки
    guard.pump = Some(SteamPump::spawn(move |stop| run_host(app, client, display_name, rom_checksum, &stop))?);
    Ok(())
}

fn run_host(app: AppHandle, client: Client, own_display_name: String, expected_checksum: String, stop: &AtomicBool) {
    let messages = client.networking_messages();

    let peer = 'wait: loop {
        if stop.load(Ordering::Relaxed) {
            return;
        }
        client.run_callbacks();

        for message in messages.receive_messages_on_channel(0, 32) {
            let Some(peer_id) = message.identity_peer().steam_id() else { continue };
            let Ok(NetplayMessage::Handshake { display_name, rom_checksum, protocol }) =
                serde_json::from_slice::<NetplayMessage>(message.data())
            else {
                continue;
            };

            let reason = handshake_rejection(protocol, &rom_checksum, &expected_checksum);
            let ok = reason.is_none();
            let ack = NetplayMessage::HandshakeAck {
                display_name: own_display_name.clone(),
                ok,
                reason,
                protocol: PROTOCOL_VERSION,
            };
            if let Ok(data) = serde_json::to_vec(&ack) {
                let _ = messages.send_message_to_user(NetworkingIdentity::new_steam_id(peer_id), CONTROL_SEND, &data, 0);
            }

            if ok {
                let Some(steam_state) = app.try_state::<Mutex<SteamNetplayState>>() else { return };
                let Ok(mut guard) = steam_state.lock() else { return };
                // Флаг проверяется под тем же мьютексом, под которым его
                // выставляет clear_session: остановленный хостинг не должен
                // записать «своего» партнёра в уже новую/закрытую сессию.
                if stop.load(Ordering::Relaxed) {
                    return;
                }
                guard.peer = Some(peer_id);
                drop(guard);
                let _ = app.emit("netplay://client-connected", PeerInfo { display_name });
                break 'wait peer_id;
            }
        }

        std::thread::sleep(POLL_INTERVAL);
    };

    relay_loop(&app, &client, peer, stop);
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
    let handshake = NetplayMessage::Handshake { display_name: own_display_name, rom_checksum, protocol: PROTOCOL_VERSION };
    let data = serde_json::to_vec(&handshake).map_err(|e| e.to_string())?;
    messages
        .send_message_to_user(NetworkingIdentity::new_steam_id(peer), CONTROL_SEND, &data, 0)
        .map_err(|e| format!("Не удалось отправить рукопожатие: {e:?}"))?;

    let deadline = tokio::time::Instant::now() + HANDSHAKE_TIMEOUT;
    loop {
        client.run_callbacks();

        for message in messages.receive_messages_on_channel(0, 32) {
            if message.identity_peer().steam_id() != Some(peer) {
                continue;
            }
            if let Ok(NetplayMessage::HandshakeAck { display_name, ok, reason, protocol }) =
                serde_json::from_slice::<NetplayMessage>(message.data())
            {
                let display_name = handshake_ack_result(display_name, ok, reason, protocol)?;
                return Ok(PeerInfo { display_name });
            }
        }

        if tokio::time::Instant::now() >= deadline {
            return Err("Хост не ответил рукопожатием (тайм-аут) — проверьте Steam ID и убедитесь, что хост уже запустил кооп".to_string());
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }
}

/// Ретрансляция ввода партнёра в Tauri-события после установленной сессии —
/// общая для хоста и клиента (крутится в фоновом потоке у обоих после
/// успешного рукопожатия). Завершается по флагу остановки или когда партнёр
/// явно прислал Disconnect; при обрыве сессии без явного сообщения — см.
/// session_failed_callback в install_callbacks (эмитит то же событие
/// независимо от этого цикла).
fn relay_loop(app: &AppHandle, client: &Client, peer: SteamId, stop: &AtomicBool) {
    let messages = client.networking_messages();
    while !stop.load(Ordering::Relaxed) {
        client.run_callbacks();

        for message in messages.receive_messages_on_channel(0, 64) {
            if message.identity_peer().steam_id() != Some(peer) {
                continue;
            }
            match serde_json::from_slice::<NetplayMessage>(message.data()) {
                Ok(NetplayMessage::Inputs(packet)) => {
                    let _ = app.emit("netplay://remote-input", packet);
                }
                Ok(NetplayMessage::Disconnect) => {
                    let _ = app.emit("netplay://peer-disconnected", ());
                    return;
                }
                _ => {} // Handshake/-Ack тут не ожидаются вне рукопожатия — игнорируем
            }
        }

        std::thread::sleep(RELAY_POLL_INTERVAL);
    }
}

/// Запускает фоновый поток ретрансляции для уже установленной (после join)
/// сессии — вызывается из commands::steam_netplay после успешного
/// рукопожатия, тем же способом, что и хостинг регистрирует свой поток.
pub fn spawn_relay(app: AppHandle, state: &Mutex<SteamNetplayState>, client: Client, peer: SteamId) -> Result<(), String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    guard.clear_session();
    guard.pump = Some(SteamPump::spawn(move |stop| relay_loop(&app, &client, peer, &stop))?);
    guard.peer = Some(peer);
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
                CONTROL_SEND,
                &data,
                0,
            );
        }
    }
    guard.clear_session();
    Ok(())
}

/// Отправляет пакет ввода партнёру — вызывается ~60 раз/сек из игрового
/// цикла (см. src/netplay/lockstep.ts), не блокирующий вызов
/// (send_message_to_user не ждёт доставки).
pub fn send_input(state: &Mutex<SteamNetplayState>, packet: InputPacket) -> Result<(), String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    let (Some(client), Some(peer)) = (&guard.client, guard.peer) else {
        return Err("Нет активной Steam-сессии".to_string());
    };
    let data = serde_json::to_vec(&NetplayMessage::Inputs(packet)).map_err(|e| e.to_string())?;
    client
        .networking_messages()
        .send_message_to_user(NetworkingIdentity::new_steam_id(peer), INPUT_SEND, &data, 0)
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
