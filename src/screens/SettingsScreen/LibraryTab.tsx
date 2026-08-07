// Вкладка «Библиотека»: папки с ROM'ами + пересканирование.
// См. docs/screens.md#2-settings-screen
import { useEffect, useState } from "react";
import { scanLibrary } from "../../api/library";
import { getRomLibraryPaths, setRomLibraryPaths } from "../../api/settings";
import styles from "./LibraryTab.module.css";

export function LibraryTab() {
  const [paths, setPaths] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [newPath, setNewPath] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState<string | null>(null);

  useEffect(() => {
    getRomLibraryPaths()
      .then(setPaths)
      .finally(() => setLoaded(true));
  }, []);

  function persist(next: string[]) {
    setPaths(next);
    setRomLibraryPaths(next).catch((err) => console.error("Не удалось сохранить пути:", err));
  }

  function handleAdd() {
    const trimmed = newPath.trim();
    if (!trimmed || paths.includes(trimmed)) return;
    persist([...paths, trimmed]);
    setNewPath("");
  }

  function handleRemove(path: string) {
    persist(paths.filter((p) => p !== path));
  }

  async function handleRescan() {
    setScanning(true);
    setScanStatus(null);
    try {
      const games = await scanLibrary();
      setScanStatus(`Готово: в библиотеке ${games.length} игр(ы).`);
    } catch (err) {
      setScanStatus(`Ошибка сканирования: ${String(err)}`);
    } finally {
      setScanning(false);
    }
  }

  return (
    <div>
      <p className={styles.hint}>
        Папки, где лаунчер ищет ROM-файлы (*.nes, *.gen), включая подпапки. Если список пуст —
        используется папка по умолчанию в данных приложения.
      </p>

      {loaded && paths.length === 0 && (
        <p className={styles.empty}>Папки не настроены — сканируется папка по умолчанию.</p>
      )}

      {paths.length > 0 && (
        <ul className={styles.list}>
          {paths.map((path) => (
            <li key={path} className={styles.row}>
              <span className={styles.path}>{path}</span>
              <button
                type="button"
                data-nav
                className={styles.removeButton}
                onClick={() => handleRemove(path)}
              >
                Удалить
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.addRow}>
        <input
          type="text"
          data-nav
          className={styles.input}
          placeholder="/home/user/ROMs/nes"
          value={newPath}
          onChange={(e) => setNewPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd();
          }}
        />
        <button type="button" data-nav className={styles.addButton} onClick={handleAdd}>
          Добавить папку
        </button>
      </div>

      <div className={styles.rescanRow}>
        <button
          type="button"
          data-nav
          className={styles.rescanButton}
          onClick={handleRescan}
          disabled={scanning}
        >
          {scanning ? "Сканирование…" : "Пересканировать библиотеку"}
        </button>
        {scanStatus && <span className={styles.status}>{scanStatus}</span>}
      </div>
    </div>
  );
}
