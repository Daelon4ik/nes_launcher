use super::{HostAnnounce, DISCOVERY_PORT};
use serde::Serialize;
use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddrV4};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::net::UdpSocket;
use tokio::time::interval;

/// Хост в списке обнаруженных игр — то, что видит клиент при поиске.
/// camelCase — соответствует src/types/netplay.ts на фронтенде.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredHost {
    pub id: String,
    pub display_name: String,
    pub game_title: String,
    pub rom_checksum: String,
    pub ip: String,
    pub tcp_port: u16,
}

/// Открывает UDP-сокет с SO_REUSEADDR (и SO_REUSEPORT на Unix), чтобы хост и
/// клиент могли слушать/слать на одной машине одновременно (актуально при
/// разработке/тестировании двумя окнами на одном компьютере).
fn bind_reusable(addr: SocketAddrV4) -> std::io::Result<std::net::UdpSocket> {
    use socket2::{Domain, Socket, Type};
    let socket = Socket::new(Domain::IPV4, Type::DGRAM, None)?;
    socket.set_reuse_address(true)?;
    #[cfg(unix)]
    socket.set_reuse_port(true)?;
    socket.set_nonblocking(true)?;
    socket.bind(&addr.into())?;
    Ok(socket.into())
}

/// Раз в секунду шлёт broadcast-анонс на DISCOVERY_PORT, пока задачу не
/// отменят (хост либо остановил хостинг, либо клиент уже подключился —
/// см. commands::netplay::netplay_start_hosting).
pub async fn run_host_broadcast(display_name: String, game_title: String, rom_checksum: String, tcp_port: u16) {
    let Ok(std_socket) = bind_reusable(SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, 0)) else {
        return;
    };
    let Ok(socket) = UdpSocket::from_std(std_socket) else {
        return;
    };
    if socket.set_broadcast(true).is_err() {
        return;
    }

    let announce = HostAnnounce { display_name, game_title, rom_checksum, tcp_port };
    let Ok(payload) = serde_json::to_vec(&announce) else {
        return;
    };
    let target = SocketAddrV4::new(Ipv4Addr::BROADCAST, DISCOVERY_PORT);

    let mut ticker = interval(Duration::from_secs(1));
    loop {
        ticker.tick().await;
        let _ = socket.send_to(&payload, target).await;
    }
}

/// Слушает анонсы хостов, эмитит `netplay://host-found` на каждый новый/
/// обновлённый анонс и `netplay://host-lost`, если анонсов от хоста не было
/// дольше STALE_AFTER (хост пропал/остановился без явного сигнала).
pub async fn run_discovery_listener(app: AppHandle) {
    const STALE_AFTER: Duration = Duration::from_secs(5);

    let Ok(std_socket) = bind_reusable(SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, DISCOVERY_PORT)) else {
        return;
    };
    let Ok(socket) = UdpSocket::from_std(std_socket) else {
        return;
    };

    let mut buf = [0u8; 1024];
    let mut seen: HashMap<String, Instant> = HashMap::new();

    loop {
        let recv = tokio::time::timeout(Duration::from_millis(500), socket.recv_from(&mut buf)).await;
        if let Ok(Ok((len, addr))) = recv {
            if let Ok(announce) = serde_json::from_slice::<HostAnnounce>(&buf[..len]) {
                let id = format!("{}:{}", addr.ip(), announce.tcp_port);
                seen.insert(id.clone(), Instant::now());
                let host = DiscoveredHost {
                    id,
                    display_name: announce.display_name,
                    game_title: announce.game_title,
                    rom_checksum: announce.rom_checksum,
                    ip: addr.ip().to_string(),
                    tcp_port: announce.tcp_port,
                };
                let _ = app.emit("netplay://host-found", host);
            }
        }

        let now = Instant::now();
        let stale: Vec<String> = seen
            .iter()
            .filter(|(_, last_seen)| now.duration_since(**last_seen) > STALE_AFTER)
            .map(|(id, _)| id.clone())
            .collect();
        for id in stale {
            seen.remove(&id);
            let _ = app.emit("netplay://host-lost", &id);
        }
    }
}
