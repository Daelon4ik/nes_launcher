// Соответствует src-tauri/src/netplay/{mod,discovery}.rs (camelCase-структуры).
export interface DiscoveredHost {
  id: string;
  displayName: string;
  gameTitle: string;
  romChecksum: string;
  ip: string;
  tcpPort: number;
}

export interface PeerInfo {
  displayName: string;
}

export type NetplayRole = "host" | "client";

// Два независимых способа установить соединение — тот же лок-степ протокол
// и движок (src/netplay/engine.ts) поверх разного транспорта: "lan" — сырой
// TCP + UDP-обнаружение в локальной сети; "steam" — P2P через Steam
// (ISteamNetworkingMessages, AppID 480 Spacewar), без обнаружения — Steam ID
// партнёра вводится вручную. См. docs/netplay.md.
export type NetplayTransport = "lan" | "steam";

// Готовая к передаче в EmulatorScreen кооп-сессия — собирается в
// NetplayLobbyScreen после успешного хостинга/подключения.
export interface NetplaySession {
  role: NetplayRole;
  transport: NetplayTransport;
  localPlayer: 1 | 2;
  peerName: string;
  romData: Uint8Array;
}
