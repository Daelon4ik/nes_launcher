// Главный экран: справа список игр, слева панель деталей выбранной игры.
// См. docs/screens.md#1-main-screen
import { useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { GameCard } from "../../components/GameCard";
import { GearIcon } from "../../components/icons";
import { useGameLibrary } from "../../hooks/useGameLibrary";
import { useSpatialNavigation } from "../../hooks/useSpatialNavigation";
import type { Game } from "../../types/game";
import styles from "./MainScreen.module.css";

function formatLastPlayed(lastPlayedAt: string | null): string {
  if (!lastPlayedAt) {
    return "Ещё не запускалась";
  }
  return `Последний запуск: ${new Date(lastPlayedAt).toLocaleDateString("ru-RU")}`;
}

function formatPlaytime(totalPlaytimeSeconds: number): string {
  if (totalPlaytimeSeconds <= 0) {
    return "Ещё не сыграно";
  }
  const hours = Math.floor(totalPlaytimeSeconds / 3600);
  const minutes = Math.floor((totalPlaytimeSeconds % 3600) / 60);
  return hours > 0 ? `В игре: ${hours} ч ${minutes} мин` : `В игре: ${minutes} мин`;
}

interface MainScreenProps {
  onOpenSettings: () => void;
  onPlay: (game: Game) => void;
}

export function MainScreen({ onOpenSettings, onPlay }: MainScreenProps) {
  const { games, loading, error, install } = useGameLibrary();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const screenRef = useRef<HTMLDivElement>(null);

  useSpatialNavigation(screenRef);

  const selectedGame = useMemo(
    () => games.find((game) => game.id === selectedId) ?? games[0] ?? null,
    [games, selectedId],
  );

  // Геймпад/клавиатура должны иметь что-то в фокусе сразу, без предварительного Tab.
  // Именно первая карточка библиотеки, а не кнопка «Играть» (та раньше в DOM, но
  // при входе на экран ожидаемее оказаться в списке игр, а не сразу на запуске).
  useEffect(() => {
    const container = screenRef.current;
    if (!container || games.length === 0) return;
    if (container.contains(document.activeElement)) return;
    container.querySelector<HTMLElement>(`.${styles.grid} [data-nav]`)?.focus();
  }, [games]);

  async function handleAddGames() {
    const selected = await open({
      multiple: true,
      filters: [{ name: "NES ROM", extensions: ["nes"] }],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    await install(paths);
  }

  return (
    <div className={styles.screen} ref={screenRef}>
      <aside className={styles.details}>
        {selectedGame ? (
          <>
            <div
              className={styles.detailsCover}
              style={
                selectedGame.coverPath ? { backgroundImage: `url(${selectedGame.coverPath})` } : undefined
              }
            />
            <h2 className={styles.detailsTitle}>{selectedGame.title}</h2>
            <p className={styles.description}>
              {selectedGame.description ?? "Описание пока не загружено."}
            </p>
            <ul className={styles.meta}>
              <li>{formatLastPlayed(selectedGame.lastPlayedAt)}</li>
              <li>{formatPlaytime(selectedGame.totalPlaytimeSeconds)}</li>
            </ul>
            <button
              type="button"
              data-nav
              className={styles.playButton}
              onClick={() => onPlay(selectedGame)}
            >
              Играть
            </button>
          </>
        ) : (
          <p className={styles.empty}>Выберите игру в библиотеке</p>
        )}
      </aside>

      <section className={styles.library}>
        <header className={styles.libraryHeader}>
          <h1 className={styles.libraryTitle}>Библиотека</h1>
          <div className={styles.headerActions}>
            <button
              type="button"
              data-nav
              className={styles.ghostButton}
              onClick={handleAddGames}
              disabled={loading}
            >
              {loading ? "Добавление…" : "Добавить игры"}
            </button>
            <button
              type="button"
              data-nav
              className={styles.settingsButton}
              onClick={onOpenSettings}
              aria-label="Настройки"
            >
              <GearIcon />
            </button>
          </div>
        </header>

        {error && <p className={styles.error}>{error}</p>}

        {!loading && games.length === 0 ? (
          <p className={styles.empty}>Библиотека пуста — добавьте игры кнопкой выше.</p>
        ) : (
          <div className={styles.grid}>
            {games.map((game) => (
              <GameCard
                key={game.id}
                game={game}
                selected={game.id === selectedGame?.id}
                onSelect={() => setSelectedId(game.id)}
                onPlay={() => onPlay(game)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
