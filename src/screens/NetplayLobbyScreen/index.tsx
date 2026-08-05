// Лобби кооп-игры: выбор роли (хост/клиент), ожидание партнёра / поиск хостов
// в LAN. Открывается с Main Screen по кнопке «Кооп» для выбранной игры,
// при успехе передаёт готовую сессию на Emulator Screen (netplay-режим).
// См. docs/screens.md#3-netplay-lobby-screen и docs/netplay.md.
import { useEffect, useRef, useState } from "react";
import { launchGame, readRomBytes } from "../../api/emulator";
import * as netplayApi from "../../api/netplay";
import { getNetworkDisplayName, getNetworkHostPort } from "../../api/settings";
import { ArrowLeftIcon } from "../../components/icons";
import { useGameLibrary } from "../../hooks/useGameLibrary";
import { useSpatialNavigation } from "../../hooks/useSpatialNavigation";
import type { Game } from "../../types/game";
import type { DiscoveredHost, NetplaySession } from "../../types/netplay";
import styles from "./NetplayLobbyScreen.module.css";

async function computeChecksum(romData: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", romData as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

type Mode = "choose" | "host" | "join";

interface NetplayLobbyScreenProps {
  game: Game;
  onReady: (session: NetplaySession) => void;
  onBack: () => void;
}

export function NetplayLobbyScreen({ game, onReady, onBack }: NetplayLobbyScreenProps) {
  const [mode, setMode] = useState<Mode>("choose");
  const screenRef = useRef<HTMLDivElement>(null);

  useSpatialNavigation(screenRef);

  useEffect(() => {
    const container = screenRef.current;
    if (!container) return;
    container.querySelector<HTMLElement>("[data-nav]")?.focus();
  }, [mode]);

  return (
    <div className={styles.screen} ref={screenRef}>
      <header className={styles.header}>
        <button
          type="button"
          data-nav
          className={styles.backButton}
          onClick={mode === "choose" ? onBack : () => setMode("choose")}
        >
          <ArrowLeftIcon />
          {mode === "choose" ? "Библиотека" : "Назад"}
        </button>
        <h1 className={styles.title}>Кооп: {game.title}</h1>
      </header>

      {mode === "choose" && (
        <div className={styles.chooseGrid}>
          <button type="button" data-nav className={styles.choiceButton} onClick={() => setMode("host")}>
            Хостить
          </button>
          <button type="button" data-nav className={styles.choiceButton} onClick={() => setMode("join")}>
            Подключиться
          </button>
        </div>
      )}
      {mode === "host" && <HostView game={game} onReady={onReady} />}
      {mode === "join" && <JoinView onReady={onReady} />}
    </div>
  );
}

type HostStatus = "preparing" | "waiting" | "error";

function HostView({ game, onReady }: { game: Game; onReady: (session: NetplaySession) => void }) {
  const [status, setStatus] = useState<HostStatus>("preparing");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unlistenConnected: (() => void) | null = null;
    let unlistenFailed: (() => void) | null = null;

    async function start() {
      try {
        const [displayName, port, romPath] = await Promise.all([
          getNetworkDisplayName(),
          getNetworkHostPort(),
          launchGame(game.id),
        ]);
        const romData = await readRomBytes(romPath);
        if (cancelled) return;
        const checksum = await computeChecksum(romData);
        if (cancelled) return;

        unlistenConnected = await netplayApi.onClientConnected((peer) => {
          if (cancelled) return;
          onReady({ role: "host", localPlayer: 1, peerName: peer.displayName, romData });
        });
        unlistenFailed = await netplayApi.onHostingFailed(() => {
          if (cancelled) return;
          setStatus("error");
          setErrorMessage("Не удалось принять подключение. Попробуйте ещё раз.");
        });

        await netplayApi.startHosting(port, displayName, game.title, checksum);
        if (!cancelled) setStatus("waiting");
      } catch (err) {
        if (!cancelled) {
          setStatus("error");
          setErrorMessage(String(err));
        }
      }
    }
    start();

    return () => {
      cancelled = true;
      netplayApi.stopHosting().catch(() => {});
      unlistenConnected?.();
      unlistenFailed?.();
    };
  }, [game.id, game.title]);

  return (
    <div className={styles.panel}>
      {status === "preparing" && <p className={styles.status}>Подготовка…</p>}
      {status === "waiting" && (
        <>
          <p className={styles.status}>Ожидание партнёра в локальной сети…</p>
          <p className={styles.hint}>
            На втором устройстве откройте «{game.title}» → «Кооп» → «Подключиться».
          </p>
        </>
      )}
      {status === "error" && <p className={styles.error}>{errorMessage}</p>}
    </div>
  );
}

function JoinView({ onReady }: { onReady: (session: NetplaySession) => void }) {
  const { games } = useGameLibrary();
  const [hosts, setHosts] = useState<DiscoveredHost[]>([]);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let unlistenFound: (() => void) | null = null;
    let unlistenLost: (() => void) | null = null;

    async function start() {
      unlistenFound = await netplayApi.onHostFound((host) => {
        setHosts((prev) => {
          const index = prev.findIndex((h) => h.id === host.id);
          if (index === -1) return [...prev, host];
          const next = [...prev];
          next[index] = host;
          return next;
        });
      });
      unlistenLost = await netplayApi.onHostLost((id) => {
        setHosts((prev) => prev.filter((h) => h.id !== id));
      });
      await netplayApi.startDiscovery();
    }
    start();

    return () => {
      netplayApi.stopDiscovery().catch(() => {});
      unlistenFound?.();
      unlistenLost?.();
    };
  }, []);

  async function handleJoin(host: DiscoveredHost) {
    const localGame = games.find((g) => g.title.toLowerCase() === host.gameTitle.toLowerCase());
    if (!localGame) {
      setErrorMessage(`Игра «${host.gameTitle}» не найдена в вашей библиотеке.`);
      return;
    }

    setConnectingId(host.id);
    setErrorMessage(null);
    try {
      const [displayName, romPath] = await Promise.all([getNetworkDisplayName(), launchGame(localGame.id)]);
      const romData = await readRomBytes(romPath);
      const checksum = await computeChecksum(romData);
      if (checksum !== host.romChecksum) {
        setErrorMessage("Ваша копия ROM отличается от версии хоста — синхронная игра невозможна.");
        setConnectingId(null);
        return;
      }
      const peer = await netplayApi.joinHost(host.ip, host.tcpPort, displayName, checksum);
      onReady({ role: "client", localPlayer: 2, peerName: peer.displayName, romData });
    } catch (err) {
      setErrorMessage(String(err));
      setConnectingId(null);
    }
  }

  return (
    <div className={styles.panel}>
      {errorMessage && <p className={styles.error}>{errorMessage}</p>}

      {hosts.length === 0 ? (
        <p className={styles.status}>Хосты не найдены. Партнёр должен начать хостинг в той же сети.</p>
      ) : (
        <ul className={styles.hostList}>
          {hosts.map((host) => {
            const owned = games.some((g) => g.title.toLowerCase() === host.gameTitle.toLowerCase());
            return (
              <li key={host.id} className={styles.hostRow}>
                <div>
                  <p className={styles.hostName}>{host.displayName}</p>
                  <p className={styles.hostGame}>
                    {host.gameTitle}
                    {!owned && " — нет в вашей библиотеке"}
                  </p>
                </div>
                <button
                  type="button"
                  data-nav
                  className={styles.joinButton}
                  disabled={!owned || connectingId !== null}
                  onClick={() => handleJoin(host)}
                >
                  {connectingId === host.id ? "Подключение…" : "Подключиться"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
