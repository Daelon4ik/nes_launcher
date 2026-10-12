use super::{NetplayMessage, SessionHandle, PROTOCOL_VERSION, VERSION_MISMATCH};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::tcp::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;

async fn read_message(reader: &mut BufReader<OwnedReadHalf>) -> std::io::Result<Option<NetplayMessage>> {
    let mut line = String::new();
    let bytes_read = reader.read_line(&mut line).await?;
    if bytes_read == 0 {
        return Ok(None); // EOF — партнёр закрыл соединение
    }
    serde_json::from_str(line.trim_end())
        .map(Some)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))
}

async fn write_message(writer: &mut OwnedWriteHalf, msg: &NetplayMessage) -> std::io::Result<()> {
    let mut line = serde_json::to_string(msg).map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    line.push('\n');
    writer.write_all(line.as_bytes()).await
}

/// Ждёт ровно одно входящее подключение и проводит рукопожатие со стороны
/// хоста. При несовпадении ROM-чексуммы (или битом сообщении) соединение
/// закрывается и цикл продолжает слушать следующую попытку — так один
/// случайный/ошибочный клиент не убивает хостинг.
pub async fn accept_and_handshake(
    listener: TcpListener,
    own_display_name: &str,
    expected_checksum: &str,
) -> std::io::Result<(TcpStream, String)> {
    loop {
        let (stream, _addr) = listener.accept().await?;
        let (read_half, mut write_half) = stream.into_split();
        let mut reader = BufReader::new(read_half);

        let handshake = read_message(&mut reader).await;
        let Ok(Some(NetplayMessage::Handshake { display_name, rom_checksum, protocol })) = handshake else {
            continue;
        };

        let reason = handshake_rejection(protocol, &rom_checksum, expected_checksum);
        let ok = reason.is_none();
        let ack = NetplayMessage::HandshakeAck {
            display_name: own_display_name.to_string(),
            ok,
            reason,
            protocol: PROTOCOL_VERSION,
        };
        if write_message(&mut write_half, &ack).await.is_err() {
            continue;
        }
        if !ok {
            continue;
        }

        let stream = reader
            .into_inner()
            .reunite(write_half)
            .expect("половины принадлежат одному TcpStream");
        return Ok((stream, display_name));
    }
}

/// Почему хост отклоняет рукопожатие (None — принимает). Общая для LAN и Steam.
pub fn handshake_rejection(protocol: u32, rom_checksum: &str, expected_checksum: &str) -> Option<String> {
    if protocol != PROTOCOL_VERSION {
        Some(VERSION_MISMATCH.to_string())
    } else if rom_checksum != expected_checksum {
        Some("ROM не совпадает у хоста и клиента".to_string())
    } else {
        None
    }
}

/// Ответ хоста на рукопожатие глазами клиента: Ok(имя хоста) или причина отказа.
/// Общая для LAN и Steam.
pub fn handshake_ack_result(display_name: String, ok: bool, reason: Option<String>, protocol: u32) -> Result<String, String> {
    if !ok {
        return Err(reason.unwrap_or_else(|| "Хост отклонил подключение".to_string()));
    }
    if protocol != PROTOCOL_VERSION {
        return Err(VERSION_MISMATCH.to_string());
    }
    Ok(display_name)
}

/// Подключается к хосту и проводит рукопожатие со стороны клиента.
pub async fn connect_and_handshake(
    ip: &str,
    port: u16,
    own_display_name: &str,
    rom_checksum: &str,
) -> Result<(TcpStream, String), String> {
    let stream = TcpStream::connect((ip, port)).await.map_err(|e| e.to_string())?;
    let (read_half, mut write_half) = stream.into_split();
    let mut reader = BufReader::new(read_half);

    let handshake = NetplayMessage::Handshake {
        display_name: own_display_name.to_string(),
        rom_checksum: rom_checksum.to_string(),
        protocol: PROTOCOL_VERSION,
    };
    write_message(&mut write_half, &handshake).await.map_err(|e| e.to_string())?;

    match read_message(&mut reader).await.map_err(|e| e.to_string())? {
        Some(NetplayMessage::HandshakeAck { display_name, ok, reason, protocol }) => {
            let display_name = handshake_ack_result(display_name, ok, reason, protocol)?;
            let stream = reader
                .into_inner()
                .reunite(write_half)
                .expect("половины принадлежат одному TcpStream");
            Ok((stream, display_name))
        }
        _ => Err("Хост не ответил рукопожатием".to_string()),
    }
}

/// Запускает reader/writer-задачи для установленной сессии. Reader эмитит
/// события по мере прихода сообщений и сам чистит `NetplayState.session`
/// при разрыве связи — второй стороне (UI) не нужно отдельно опрашивать
/// состояние соединения.
pub fn spawn_session(app: AppHandle, stream: TcpStream) -> SessionHandle {
    // Без TCP_NODELAY крошечные пакеты ввода (по одному на кадр) Nagle
    // придерживает до подтверждения предыдущего — лишняя задержка и джиттер.
    let _ = stream.set_nodelay(true);
    let (read_half, write_half) = stream.into_split();
    let (outgoing_tx, outgoing_rx) = mpsc::unbounded_channel();

    tauri::async_runtime::spawn(run_writer(write_half, outgoing_rx));
    let reader_task = tauri::async_runtime::spawn(run_reader(app, BufReader::new(read_half)));

    SessionHandle { outgoing_tx, reader_task }
}

async fn run_writer(mut writer: OwnedWriteHalf, mut rx: mpsc::UnboundedReceiver<NetplayMessage>) {
    while let Some(msg) = rx.recv().await {
        if write_message(&mut writer, &msg).await.is_err() {
            break;
        }
    }
}

async fn run_reader(app: AppHandle, mut reader: BufReader<OwnedReadHalf>) {
    loop {
        match read_message(&mut reader).await {
            Ok(Some(NetplayMessage::Inputs(packet))) => {
                let _ = app.emit("netplay://remote-input", packet);
            }
            Ok(Some(NetplayMessage::Disconnect)) | Ok(None) => break,
            Ok(Some(_)) => {} // Handshake/-Ack тут не ожидаются вне рукопожатия — игнорируем
            Err(_) => break,
        }
    }

    let _ = app.emit("netplay://peer-disconnected", ());
    // Сессию мог уже очистить netplay_disconnect (явный выход) — тогда просто
    // ничего не делаем, вместо этого предполагая "reader_task" совпадёт с уже
    // отменённой задачей (abort — не проблема после того как она сама вышла).
    if let Some(state) = app.try_state::<std::sync::Mutex<super::NetplayState>>() {
        if let Ok(mut guard) = state.lock() {
            guard.session = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn handshake_succeeds_with_matching_checksum() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        let host_task =
            tokio::spawn(async move { accept_and_handshake(listener, "Host", "abc123").await.unwrap() });

        let (_client_stream, peer_name_seen_by_client) =
            connect_and_handshake(&addr.ip().to_string(), addr.port(), "Client", "abc123")
                .await
                .unwrap();
        assert_eq!(peer_name_seen_by_client, "Host");

        let (_host_stream, peer_name_seen_by_host) = host_task.await.unwrap();
        assert_eq!(peer_name_seen_by_host, "Client");
    }

    #[test]
    fn rejects_peer_with_other_protocol_version() {
        // Handshake старой версии лаунчера — без поля protocol вовсе.
        let old: NetplayMessage =
            serde_json::from_str(r#"{"type":"Handshake","display_name":"Old","rom_checksum":"abc"}"#).unwrap();
        let NetplayMessage::Handshake { protocol, .. } = old else { panic!("ожидался Handshake") };
        assert_eq!(protocol, 0);
        assert_eq!(handshake_rejection(protocol, "abc", "abc").as_deref(), Some(VERSION_MISMATCH));
        assert!(handshake_rejection(PROTOCOL_VERSION, "abc", "abc").is_none());
        assert!(handshake_rejection(PROTOCOL_VERSION, "abc", "other").is_some());

        // Клиент новой версии против хоста старой: тот ответил ok без protocol.
        assert_eq!(handshake_ack_result("Host".into(), true, None, 0).unwrap_err(), VERSION_MISMATCH);
        // Причина отказа хоста важнее несовпадения версий.
        assert_eq!(handshake_ack_result("Host".into(), false, Some("ROM".into()), 0).unwrap_err(), "ROM");
        assert_eq!(handshake_ack_result("Host".into(), true, None, PROTOCOL_VERSION).unwrap(), "Host");
    }

    #[test]
    fn input_packet_wire_format_matches_frontend() {
        // Те же поля, что у InputPacket в src/netplay/lockstep.ts.
        let msg: NetplayMessage =
            serde_json::from_str(r#"{"type":"Inputs","first":6,"buttons":[0,1,255],"ack":9,"margin":2.5}"#).unwrap();
        let NetplayMessage::Inputs(packet) = msg else { panic!("ожидался Inputs") };
        assert_eq!((packet.first, packet.buttons.as_slice(), packet.ack, packet.margin), (6, &[0u8, 1, 255][..], 9, 2.5));

        let event = serde_json::to_value(&packet).unwrap();
        assert_eq!(event, serde_json::json!({ "first": 6, "buttons": [0, 1, 255], "ack": 9, "margin": 2.5 }));
    }

    #[tokio::test]
    async fn handshake_rejects_mismatched_checksum() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        tokio::spawn(async move {
            let _ = accept_and_handshake(listener, "Host", "abc123").await;
        });

        let result = connect_and_handshake(&addr.ip().to_string(), addr.port(), "Client", "different").await;
        assert!(result.is_err());
    }
}
