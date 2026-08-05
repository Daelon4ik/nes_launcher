import { invoke } from "@tauri-apps/api/core";
import type { Theme } from "../types/settings";

export function getTheme(): Promise<Theme> {
  return invoke("get_theme");
}

export function setTheme(theme: Theme): Promise<void> {
  return invoke("set_theme", { theme });
}

export function getRomLibraryPaths(): Promise<string[]> {
  return invoke("get_rom_library_paths");
}

export function setRomLibraryPaths(paths: string[]): Promise<void> {
  return invoke("set_rom_library_paths", { paths });
}
