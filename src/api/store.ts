import { invoke } from "@tauri-apps/api/core";
import type { Game } from "../types/game";
import type { StoreFile, StoreGameSummary, StoreListingPage } from "../types/store";

export function storeSearch(query: string): Promise<StoreGameSummary[]> {
  return invoke("store_search", { query });
}

export function storeBrowse(letter: string, page: number): Promise<StoreListingPage> {
  return invoke("store_browse", { letter, page });
}

export function storeListFiles(slug: string): Promise<StoreFile[]> {
  return invoke("store_list_files", { slug });
}

export function storeInstall(
  slug: string,
  fid: string,
  title: string,
  targetDir: string | null,
): Promise<Game[]> {
  return invoke("store_install", { slug, fid, title, targetDir });
}
