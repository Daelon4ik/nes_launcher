import { invoke } from "@tauri-apps/api/core";
import type { Theme } from "../types/settings";

export function getTheme(): Promise<Theme> {
  return invoke("get_theme");
}

export function setTheme(theme: Theme): Promise<void> {
  return invoke("set_theme", { theme });
}

export function getVolume(): Promise<number> {
  return invoke("get_volume");
}

export function setVolume(volume: number): Promise<void> {
  return invoke("set_volume", { volume });
}

export function getRomLibraryPaths(): Promise<string[]> {
  return invoke("get_rom_library_paths");
}

export function setRomLibraryPaths(paths: string[]): Promise<void> {
  return invoke("set_rom_library_paths", { paths });
}

export function getNetworkDisplayName(): Promise<string> {
  return invoke("get_network_display_name");
}

export function setNetworkDisplayName(name: string): Promise<void> {
  return invoke("set_network_display_name", { name });
}

export function getNetworkHostPort(): Promise<number> {
  return invoke("get_network_host_port");
}

export function setNetworkHostPort(port: number): Promise<void> {
  return invoke("set_network_host_port", { port });
}
