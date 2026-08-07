import { invoke } from "@tauri-apps/api/core";
import type { Game } from "../types/game";
import type { StoreFile, StoreGameSummary, StoreListingPage, StorePlatform } from "../types/store";

export function storeSearch(query: string, platform: StorePlatform): Promise<StoreGameSummary[]> {
  return invoke("store_search", { query, platform });
}

export function storeBrowse(letter: string, page: number, platform: StorePlatform): Promise<StoreListingPage> {
  return invoke("store_browse", { letter, page, platform });
}

export function storeListFiles(slug: string, platform: StorePlatform): Promise<StoreFile[]> {
  return invoke("store_list_files", { slug, platform });
}

// Скачивает/кэширует превью-картинку карточки на бэкенде (хотлинк на ss.emu-land.net
// заблокирован по Referer, см. store-tauri/src/commands/store.rs::store_cover_image) —
// возвращает локальный путь, готовый для convertFileSrc (см. src/utils/coverImage.ts).
export function storeCoverImage(slug: string, url: string): Promise<string> {
  return invoke("store_cover_image", { slug, url });
}

// replaceGameId: не новая установка, а смена версии уже установленной игры (см.
// StoreScreen) — та же запись в библиотеке (и её история) сохраняется, меняется
// только файл; targetDir в этом случае бэкенд игнорирует (новый файл встаёт в ту
// же папку, что и старый).
export function storeInstall(
  slug: string,
  fid: string,
  title: string,
  platform: StorePlatform,
  targetDir: string | null,
  replaceGameId: number | null,
): Promise<Game[]> {
  return invoke("store_install", { slug, fid, title, platform, targetDir, replaceGameId });
}
