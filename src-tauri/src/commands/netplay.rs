use crate::netplay::{discovery, session, NetplayMessage, NetplayState, PeerInfo};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::net::TcpListener;

/// Начинает хостинг: слушает TCP-порт и одновременно рассылает UDP-анонсы
/// для LAN-обнаружения (см. netplay/discovery.rs). Команда возвращается сразу
/// после запуска фоновых задач — сам приём клиента асинхронный, экран лобби
/// узнаёт о подключении по событию `netplay://client-connected`.
#[tauri::command]
pub async fn netplay_start_hosting(
    app: AppHandle,
    state: State<'_, Mutex<NetplayState>>,
    port: u16,
    display_name: String,
    game_title: String,
    rom_checksum: String,
) -> Result<(), String> {
    let listener = TcpListener::bind(("0.0.0.0", port)).await.map_err(|e| e.to_string())?;

    let broadcast_task = tauri::async_runtime::spawn(discovery::run_host_broadcast(
        display_name.clone(),
        game_title,
        rom_checksum.clone(),
        port,
    ));

    let accept_app = app.clone();
    let accept_display_name = display_name.clone();
    let accept_checksum = rom_checksum.clone();
    let accept_task = tauri::async_runtime::spawn(async move {
        match session::accept_and_handshake(listener, &accept_display_name, &accept_checksum).await {
            Ok((stream, peer_name)) => {
                let Some(netplay_state) = accept_app.try_state::<Mutex<NetplayState>>() else { return };
                let Ok(mut guard) = netplay_state.lock() else { return };
                guard.stop_hosting(); // анонс больше не нужен — партнёр найден
                guard.session = Some(session::spawn_session(accept_app.clone(), stream));
                drop(guard);
                let _ = accept_app.emit("netplay://client-connected", PeerInfo { display_name: peer_name });
            }
            Err(_) => {
                let _ = accept_app.emit("netplay://hosting-failed", ());
            }
        }
    });

    let mut guard = state.lock().map_err(|e| e.to_string())?;
    guard.stop_hosting(); // повторный вызов не должен плодить задачи
    guard.hosting_broadcast_task = Some(broadcast_task);
    guard.hosting_accept_task = Some(accept_task);
    Ok(())
}

/// Отменяет анонс/приём подключения (кнопка «Отмена» в лобби хоста, пока
/// партнёр ещё не подключился). Уже установленную игровую сессию не трогает.
#[tauri::command]
pub fn netplay_stop_hosting(state: State<'_, Mutex<NetplayState>>) -> Result<(), String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    guard.stop_hosting();
    Ok(())
}

/// Начинает слушать LAN-анонсы хостов. Найденные/пропавшие хосты приходят
/// событиями `netplay://host-found` / `netplay://host-lost`.
#[tauri::command]
pub fn netplay_start_discovery(app: AppHandle, state: State<'_, Mutex<NetplayState>>) -> Result<(), String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    guard.stop_discovery();
    guard.discovery_task = Some(tauri::async_runtime::spawn(discovery::run_discovery_listener(app)));
    Ok(())
}

#[tauri::command]
pub fn netplay_stop_discovery(state: State<'_, Mutex<NetplayState>>) -> Result<(), String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    guard.stop_discovery();
    Ok(())
}

/// Подключается к хосту и проводит рукопожатие (сверка ROM-чексуммы). При
/// успехе сразу поднимает игровую сессию — экран лобби переходит в эмулятор,
/// как только промис резолвится.
#[tauri::command]
pub async fn netplay_join_host(
    app: AppHandle,
    state: State<'_, Mutex<NetplayState>>,
    ip: String,
    port: u16,
    display_name: String,
    rom_checksum: String,
) -> Result<PeerInfo, String> {
    let (stream, peer_name) = session::connect_and_handshake(&ip, port, &display_name, &rom_checksum).await?;

    let mut guard = state.lock().map_err(|e| e.to_string())?;
    guard.stop_discovery(); // поиск больше не нужен
    guard.session = Some(session::spawn_session(app, stream));
    Ok(PeerInfo { display_name: peer_name })
}

/// Отправляет состояние кнопок за кадр партнёру. Вызывается ~60 раз/сек из
/// игрового цикла (src/netplay/engine.ts) — синхронная и не блокирующая:
/// просто кладёт сообщение в канал writer-задачи (netplay/session.rs).
#[tauri::command]
pub fn netplay_send_input(state: State<'_, Mutex<NetplayState>>, frame: u32, buttons: u8) -> Result<(), String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    match &guard.session {
        Some(session) => session
            .outgoing_tx
            .send(NetplayMessage::Input { frame, buttons })
            .map_err(|e| e.to_string()),
        None => Err("Нет активной кооп-сессии".to_string()),
    }
}

/// Явный выход из кооп-сессии (кнопка «Выход» в эмуляторе). Уведомляет
/// партнёра best-effort и сразу освобождает состояние — в отличие от
/// разрыва по таймауту, ждать здесь нечего.
#[tauri::command]
pub fn netplay_disconnect(state: State<'_, Mutex<NetplayState>>) -> Result<(), String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    if let Some(session) = &guard.session {
        let _ = session.outgoing_tx.send(NetplayMessage::Disconnect);
    }
    guard.stop_discovery();
    guard.stop_hosting();
    guard.clear_session();
    Ok(())
}
