import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Порт и watch-исключения синхронизированы с src-tauri/tauri.conf.json (build.devUrl).
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
