// Соответствует src-tauri/src/db/models.rs::Game и docs/data-model.md
export interface Game {
  id: number;
  title: string;
  romPath: string;
  description: string | null;
  coverPath: string | null;
  lastPlayedAt: string | null;
  totalPlaytimeSeconds: number;
  addedAt: string;
}
