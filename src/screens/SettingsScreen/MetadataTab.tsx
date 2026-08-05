// Вкладка «Метаданные»: описания/обложки игр с emu-land.net (раздел NES/Dendy).
// См. docs/screens.md#2-settings-screen
import { useEffect, useState } from "react";
import { listGames } from "../../api/library";
import { updateMetadata } from "../../api/metadata";
import type { Game } from "../../types/game";
import { coverImageStyle } from "../../utils/coverImage";
import styles from "./MetadataTab.module.css";

type RowStatus = "idle" | "loading" | "done" | "error";

export function MetadataTab() {
  const [games, setGames] = useState<Game[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [statuses, setStatuses] = useState<Record<number, RowStatus>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [bulkRunning, setBulkRunning] = useState(false);

  useEffect(() => {
    listGames()
      .then(setGames)
      .finally(() => setLoaded(true));
  }, []);

  async function updateOne(gameId: number) {
    setStatuses((prev) => ({ ...prev, [gameId]: "loading" }));
    try {
      const updated = await updateMetadata(gameId);
      setGames((prev) => prev.map((game) => (game.id === gameId ? updated : game)));
      setStatuses((prev) => ({ ...prev, [gameId]: "done" }));
    } catch (err) {
      setErrors((prev) => ({ ...prev, [gameId]: String(err) }));
      setStatuses((prev) => ({ ...prev, [gameId]: "error" }));
    }
  }

  async function updateAllMissing() {
    setBulkRunning(true);
    // Последовательно, а не параллельно — чтобы не долбить сайт разом запросами на каждую игру.
    for (const game of games.filter((g) => !g.description)) {
      await updateOne(game.id);
    }
    setBulkRunning(false);
  }

  const missingCount = games.filter((g) => !g.description).length;

  return (
    <div>
      <p className={styles.hint}>
        Источник — emu-land.net (раздел NES/Dendy). Поиск идёт по названию игры в библиотеке;
        если совпадений несколько, предпочитается точное совпадение по названию.
      </p>

      {games.length > 0 && (
        <div className={styles.toolbar}>
          <button
            type="button"
            data-nav
            className={styles.bulkButton}
            onClick={updateAllMissing}
            disabled={bulkRunning || missingCount === 0}
          >
            {bulkRunning ? "Обновление…" : `Обновить все без описания (${missingCount})`}
          </button>
        </div>
      )}

      {loaded && games.length === 0 ? (
        <p className={styles.empty}>Библиотека пуста — сначала добавьте игры на главном экране.</p>
      ) : (
        <ul className={styles.list}>
          {games.map((game) => {
            const status = statuses[game.id] ?? "idle";
            return (
              <li key={game.id} className={styles.row}>
                <div className={styles.thumb} style={coverImageStyle(game.coverPath)} />
                <div className={styles.info}>
                  <div className={styles.title}>{game.title}</div>
                  <div className={status === "error" ? `${styles.status} ${styles.statusError}` : styles.status}>
                    {status === "error"
                      ? errors[game.id]
                      : game.description
                        ? "Есть описание"
                        : "Нет описания"}
                  </div>
                </div>
                <button
                  type="button"
                  data-nav
                  className={styles.rowButton}
                  onClick={() => updateOne(game.id)}
                  disabled={status === "loading" || bulkRunning}
                >
                  {status === "loading" ? "…" : "Обновить"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
