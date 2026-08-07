//! Tauri-команды второго транспорта кооп-сессии — P2P через Steam (см.
//! src-tauri/src/netplay/steam.rs — вся реальная логика там, здесь только
//! тонкие обёртки, извлекающие managed state). См. docs/netplay.md.
use crate::netplay::{steam, PeerInfo, SteamNetplayState};
use std::sync::Mutex;
use tauri::{AppHandle, State};

/// Собственный Steam ID пользователя — показывается в UI хостинга для
/// копирования и передачи партнёру (обмен вручную, без матчмейкинга/лобби).
#[tauri::command]
pub fn steam_local_id(state: State<'_, Mutex<SteamNetplayState>>) -> Result<String, String> {
    let client = steam::ensure_client(&state)?;
    Ok(steam::local_steam_id(&client))
}

#[tauri::command]
pub fn steam_start_hosting(
    app: AppHandle,
    state: State<'_, Mutex<SteamNetplayState>>,
    display_name: String,
    rom_checksum: String,
) -> Result<(), String> {
    steam::start_hosting(app, &state, display_name, rom_checksum)
}

/// Подключается к хосту по его Steam ID (введён пользователем вручную).
#[tauri::command]
pub async fn steam_join(
    app: AppHandle,
    state: State<'_, Mutex<SteamNetplayState>>,
    peer_steam_id: String,
    display_name: String,
    rom_checksum: String,
) -> Result<PeerInfo, String> {
    let peer = steam::parse_peer_id(&peer_steam_id)?;
    let client = steam::ensure_client(&state)?;
    steam::install_callbacks(&app, &client);
    let peer_info = steam::join(&client, peer, display_name, rom_checksum).await?;
    steam::spawn_relay(app, &state, client, peer)?;
    Ok(peer_info)
}

#[tauri::command]
pub fn steam_send_input(state: State<'_, Mutex<SteamNetplayState>>, frame: u32, buttons: u8) -> Result<(), String> {
    steam::send_input(&state, frame, buttons)
}

#[tauri::command]
pub fn steam_disconnect(state: State<'_, Mutex<SteamNetplayState>>) -> Result<(), String> {
    steam::disconnect(&state)
}
