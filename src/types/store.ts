// Соответствует src-tauri/src/store/scraper.rs и docs/store.md

// Соответствует src-tauri/src/store/scraper.rs::StorePlatform — какой раздел
// emu-land.net используется для поиска/просмотра/установки (см. docs/platforms.md).
export type StorePlatform = "nes" | "genesis";

export interface StoreGameSummary {
  slug: string;
  title: string;
  imageUrl: string | null;
}

export interface StoreListingPage {
  games: StoreGameSummary[];
  totalPages: number;
}

export interface StoreFile {
  fid: string;
  name: string;
  size: string | null;
  section: string;
}

// Буквы алфавитных вкладок раздела ROM'ов — совпадает с BROWSE_LETTERS в
// src-tauri/src/store/scraper.rs (реальная навигация сайта, проверена вживую).
export const BROWSE_LETTERS = [
  "0-9", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n",
  "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z",
] as const;
