import { invoke } from "@tauri-apps/api/core";
import type { Game } from "../types/game";

export function scanLibrary(): Promise<Game[]> {
  return invoke("scan_library");
}

export function listGames(): Promise<Game[]> {
  return invoke("list_games");
}

export function installGames(paths: string[]): Promise<Game[]> {
  return invoke("install_games", { paths });
}
