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

type Transport = "lan" | "steam";
// Сначала выбор транспорта (см. docs/netplay.md — LAN/Steam независимы и
// равноправны), затем уже роль — Хостить/Подключиться работают одинаково на
// обоих транспортах, поэтому это два отдельных, последовательных шага, а не
// сразу четыре кнопки одним списком.
type Mode = "transport" | "role" | "host" | "join";

interface NetplayLobbyScreenProps {
  game: Game;
  onReady: (session: NetplaySession) => void;
  onBack: () => void;
}

export function NetplayLobbyScreen({ game, onReady, onBack }: NetplayLobbyScreenProps) {
  const [mode, setMode] = useState<Mode>("transport");
  const [transport, setTransport] = useState<Transport>("lan");
  const screenRef = useRef<HTMLDivElement>(null);

  useSpatialNavigation(screenRef);

  useEffect(() => {
    const container = screenRef.current;
    if (!container) return;
    container.querySelector<HTMLElement>("[data-nav]")?.focus();
  }, [mode]);

  function handleBack() {
    if (mode === "transport") {
      onBack();
    } else if (mode === "role") {
      setMode("transport");
    } else {
      setMode("role");
    }
  }

  function chooseTransport(next: Transport) {
    setTransport(next);
    setMode("role");
  }

  return (
    <div className={styles.screen} ref={screenRef}>
      <header className={styles.header}>
        <button type="button" data-nav className={styles.backButton} onClick={handleBack}>
          <ArrowLeftIcon />
          {mode === "transport" ? "Библиотека" : "Назад"}
        </button>
        <h1 className={styles.title}>Кооп: {game.title}</h1>
      </header>

      {mode === "transport" && (
        <div className={styles.chooseGrid}>
          <button type="button" data-nav className={styles.choiceButton} onClick={() => chooseTransport("lan")}>
            LAN
          </button>
          <button type="button" data-nav className={styles.choiceButton} onClick={() => chooseTransport("steam")}>
            Steam
          </button>
        </div>
      )}
      {mode === "role" && (
        <div className={styles.chooseGrid}>
          <button type="button" data-nav className={styles.choiceButton} onClick={() => setMode("host")}>
            Хостить
          </button>
          <button type="button" data-nav className={styles.choiceButton} onClick={() => setMode("join")}>
            Подключиться
          </button>
        </div>
      )}
      {mode === "host" &&
        (transport === "lan" ? <HostView game={game} onReady={onReady} /> : <SteamHostView game={game} onReady={onReady} />)}
      {mode === "join" &&
        (transport === "lan" ? <JoinView onReady={onReady} /> : <SteamJoinView game={game} onReady={onReady} />)}
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
          onReady({ role: "host", transport: "lan", localPlayer: 1, peerName: peer.displayName, romData });
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
            На втором устройстве откройте «{game.title}» → «Кооп» → «LAN» → «Подключиться».
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
      onReady({ role: "client", transport: "lan", localPlayer: 2, peerName: peer.displayName, romData });
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

type SteamHostStatus = "preparing" | "waiting" | "error";

// Второй транспорт (см. docs/netplay.md) — без LAN-обнаружения: хост
// показывает свой Steam ID, партнёр вводит его вручную на своей стороне
// (SteamJoinView). netplay://client-connected — то же событие, что у LAN.
function SteamHostView({ game, onReady }: { game: Game; onReady: (session: NetplaySession) => void }) {
  const [status, setStatus] = useState<SteamHostStatus>("preparing");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [localId, setLocalId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let unlistenConnected: (() => void) | null = null;

    async function start() {
      try {
        const [displayName, romPath, steamId] = await Promise.all([
          getNetworkDisplayName(),
          launchGame(game.id),
          netplayApi.steamLocalId(),
        ]);
        if (cancelled) return;
        setLocalId(steamId);
        const romData = await readRomBytes(romPath);
        if (cancelled) return;
        const checksum = await computeChecksum(romData);
        if (cancelled) return;

        unlistenConnected = await netplayApi.onClientConnected((peer) => {
          if (cancelled) return;
          onReady({ role: "host", transport: "steam", localPlayer: 1, peerName: peer.displayName, romData });
        });

        await netplayApi.steamStartHosting(displayName, checksum);
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
      netplayApi.steamDisconnect().catch(() => {});
      unlistenConnected?.();
    };
  }, [game.id]);

  function handleCopy() {
    if (!localId) return;
    navigator.clipboard.writeText(localId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className={styles.panel}>
      {status === "preparing" && <p className={styles.status}>Подготовка…</p>}
      {localId && status !== "error" && (
        <div className={styles.steamIdRow}>
          <span className={styles.status}>Ваш Steam ID:</span>
          <code className={styles.steamId}>{localId}</code>
          <button type="button" data-nav className={styles.copyButton} onClick={handleCopy}>
            {copied ? "Скопировано" : "Копировать"}
          </button>
        </div>
      )}
      {status === "waiting" && (
        <>
          <p className={styles.status}>Ожидание партнёра через Steam…</p>
          <p className={styles.hint}>
            Отправьте партнёру свой Steam ID выше (голосом, в чате — как угодно). На его устройстве: «{game.title}» →
            «Кооп» → «Steam» → «Подключиться».
          </p>
        </>
      )}
      {status === "error" && <p className={styles.error}>{errorMessage}</p>}
    </div>
  );
}

interface SteamJoinPrep {
  displayName: string;
  romData: Uint8Array;
  checksum: string;
}

function SteamJoinView({ game, onReady }: { game: Game; onReady: (session: NetplaySession) => void }) {
  const [peerIdInput, setPeerIdInput] = useState("");
  const [prep, setPrep] = useState<SteamJoinPrep | null>(null);
  const [prepError, setPrepError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function prepare() {
      try {
        const [displayName, romPath] = await Promise.all([getNetworkDisplayName(), launchGame(game.id)]);
        const romData = await readRomBytes(romPath);
        if (cancelled) return;
        const checksum = await computeChecksum(romData);
        if (cancelled) return;
        setPrep({ displayName, romData, checksum });
      } catch (err) {
        if (!cancelled) setPrepError(String(err));
      }
    }
    prepare();

    return () => {
      cancelled = true;
    };
  }, [game.id]);

  async function handleConnect() {
    if (!prep) return;
    setConnecting(true);
    setErrorMessage(null);
    try {
      const peer = await netplayApi.steamJoin(peerIdInput, prep.displayName, prep.checksum);
      onReady({ role: "client", transport: "steam", localPlayer: 2, peerName: peer.displayName, romData: prep.romData });
    } catch (err) {
      setErrorMessage(String(err));
      setConnecting(false);
    }
  }

  return (
    <div className={styles.panel}>
      {prepError && <p className={styles.error}>{prepError}</p>}
      {errorMessage && <p className={styles.error}>{errorMessage}</p>}
      {!prep && !prepError && <p className={styles.status}>Подготовка…</p>}
      {prep && (
        <>
          <p className={styles.hint}>Введите Steam ID партнёра — он должен прислать его со своего экрана хостинга.</p>
          <input
            type="text"
            inputMode="numeric"
            data-nav
            className={styles.steamIdInput}
            placeholder="76561198000000000"
            value={peerIdInput}
            onChange={(e) => setPeerIdInput(e.target.value)}
            disabled={connecting}
          />
          <button
            type="button"
            data-nav
            className={styles.joinButton}
            disabled={connecting || peerIdInput.trim().length === 0}
            onClick={handleConnect}
          >
            {connecting ? "Подключение…" : "Подключиться"}
          </button>
        </>
      )}
    </div>
  );
}
