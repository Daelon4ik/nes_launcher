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

// Готовая к передаче в EmulatorScreen кооп-сессия — собирается в
// NetplayLobbyScreen после успешного хостинга/подключения.
export interface NetplaySession {
  role: NetplayRole;
  localPlayer: 1 | 2;
  peerName: string;
  romData: Uint8Array;
}
