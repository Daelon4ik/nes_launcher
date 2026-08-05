import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { DiscoveredHost, PeerInfo } from "../types/netplay";

export function startHosting(
  port: number,
  displayName: string,
  gameTitle: string,
  romChecksum: string,
): Promise<void> {
  return invoke("netplay_start_hosting", { port, displayName, gameTitle, romChecksum });
}

export function stopHosting(): Promise<void> {
  return invoke("netplay_stop_hosting");
}

export function startDiscovery(): Promise<void> {
  return invoke("netplay_start_discovery");
}

export function stopDiscovery(): Promise<void> {
  return invoke("netplay_stop_discovery");
}

export function joinHost(
  ip: string,
  port: number,
  displayName: string,
  romChecksum: string,
): Promise<PeerInfo> {
  return invoke("netplay_join_host", { ip, port, displayName, romChecksum });
}

// Вызывается из игрового цикла ~60 раз/сек (см. src/netplay/engine.ts) —
// fire-and-forget: ждать ответ каждый кадр значило бы завязывать локальный
// рендер на IPC round-trip. Ошибку (например, партнёр уже отключился) не
// пробрасываем — сессия и так узнает об этом по netplay://peer-disconnected.
export function sendInput(frame: number, buttons: number): void {
  invoke("netplay_send_input", { frame, buttons }).catch(() => {});
}

export function disconnect(): Promise<void> {
  return invoke("netplay_disconnect");
}

export function onClientConnected(cb: (peer: PeerInfo) => void): Promise<UnlistenFn> {
  return listen<PeerInfo>("netplay://client-connected", (e) => cb(e.payload));
}

export function onHostingFailed(cb: () => void): Promise<UnlistenFn> {
  return listen("netplay://hosting-failed", () => cb());
}

export function onHostFound(cb: (host: DiscoveredHost) => void): Promise<UnlistenFn> {
  return listen<DiscoveredHost>("netplay://host-found", (e) => cb(e.payload));
}

export function onHostLost(cb: (hostId: string) => void): Promise<UnlistenFn> {
  return listen<string>("netplay://host-lost", (e) => cb(e.payload));
}

export function onRemoteInput(cb: (frame: number, buttons: number) => void): Promise<UnlistenFn> {
  return listen<{ frame: number; buttons: number }>("netplay://remote-input", (e) =>
    cb(e.payload.frame, e.payload.buttons),
  );
}

export function onPeerDisconnected(cb: () => void): Promise<UnlistenFn> {
  return listen("netplay://peer-disconnected", () => cb());
}
