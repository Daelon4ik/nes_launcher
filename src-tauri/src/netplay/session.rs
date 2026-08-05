use super::{NetplayMessage, SessionHandle};
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
        let Ok(Some(NetplayMessage::Handshake { display_name, rom_checksum })) = handshake else {
            continue;
        };

        let ok = rom_checksum == expected_checksum;
        let ack = NetplayMessage::HandshakeAck {
            display_name: own_display_name.to_string(),
            ok,
            reason: if ok { None } else { Some("ROM не совпадает у хоста и клиента".to_string()) },
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
    };
    write_message(&mut write_half, &handshake).await.map_err(|e| e.to_string())?;

    match read_message(&mut reader).await.map_err(|e| e.to_string())? {
        Some(NetplayMessage::HandshakeAck { display_name, ok: true, .. }) => {
            let stream = reader
                .into_inner()
                .reunite(write_half)
                .expect("половины принадлежат одному TcpStream");
            Ok((stream, display_name))
        }
        Some(NetplayMessage::HandshakeAck { ok: false, reason, .. }) => {
            Err(reason.unwrap_or_else(|| "Хост отклонил подключение".to_string()))
        }
        _ => Err("Хост не ответил рукопожатием".to_string()),
    }
}

/// Запускает reader/writer-задачи для установленной сессии. Reader эмитит
/// события по мере прихода сообщений и сам чистит `NetplayState.session`
/// при разрыве связи — второй стороне (UI) не нужно отдельно опрашивать
/// состояние соединения.
pub fn spawn_session(app: AppHandle, stream: TcpStream) -> SessionHandle {
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
            Ok(Some(NetplayMessage::Input { frame, buttons })) => {
                let _ = app.emit("netplay://remote-input", serde_json::json!({ "frame": frame, "buttons": buttons }));
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
