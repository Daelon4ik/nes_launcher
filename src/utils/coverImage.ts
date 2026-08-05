import type { CSSProperties } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";

// cover_path в БД — локальный файл (<app-data>/covers/<id>.<ext>), скачанный бэкендом:
// эмуленд блокирует хотлинки по Referer, отдать их URL напрямую в webview нельзя (403).
// convertFileSrc() требует enable+scope в tauri.conf.json → app.security.assetProtocol.
export function coverImageStyle(coverPath: string | null): CSSProperties | undefined {
  if (!coverPath) return undefined;
  return { backgroundImage: `url("${convertFileSrc(coverPath)}")` };
}
