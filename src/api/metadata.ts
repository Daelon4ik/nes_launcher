import { invoke } from "@tauri-apps/api/core";
import type { Game } from "../types/game";

export function updateMetadata(gameId: number): Promise<Game> {
  return invoke("update_metadata", { gameId });
}
