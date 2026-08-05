import { invoke } from "@tauri-apps/api/core";

export interface SaveSlot {
  slot: number;
  createdAt: string | null;
}

export function listSaveSlots(gameId: number): Promise<SaveSlot[]> {
  return invoke("list_save_slots", { gameId });
}

export function saveState(gameId: number, slot: number, data: string): Promise<void> {
  return invoke("save_state", { gameId, slot, data });
}

export function loadState(gameId: number, slot: number): Promise<string> {
  return invoke("load_state", { gameId, slot });
}
