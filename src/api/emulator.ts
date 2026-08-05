import { invoke } from "@tauri-apps/api/core";

export function launchGame(gameId: number): Promise<string> {
  return invoke("launch_game", { gameId });
}

export async function readRomBytes(path: string): Promise<Uint8Array> {
  const bytes = await invoke<number[]>("read_rom_bytes", { path });
  return new Uint8Array(bytes);
}

export function recordSession(gameId: number, durationSeconds: number): Promise<void> {
  return invoke("record_session", { gameId, durationSeconds });
}
