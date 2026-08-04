import { invoke } from "@tauri-apps/api/core";

export function launchGame(gameId: number): Promise<string> {
  return invoke("launch_game", { gameId });
}

export function recordSession(gameId: number, durationSeconds: number): Promise<void> {
  return invoke("record_session", { gameId, durationSeconds });
}
