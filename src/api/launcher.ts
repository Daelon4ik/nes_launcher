import { getVersion } from "@tauri-apps/api/app";

export function getLauncherVersion(): Promise<string> {
  return getVersion();
}
