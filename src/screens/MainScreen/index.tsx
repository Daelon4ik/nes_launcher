// Главный экран: справа список игр, слева панель деталей выбранной игры.
// См. docs/screens.md#1-main-screen
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { GameCard } from "../../components/GameCard";
import { GearIcon } from "../../components/icons";
import { useGameLibrary } from "../../hooks/useGameLibrary";
import { useSpatialNavigation } from "../../hooks/useSpatialNavigation";
import type { Game } from "../../types/game";
import { coverImageStyle } from "../../utils/coverImage";
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
  const { games, loading, error, install, remove } = useGameLibrary();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const screenRef = useRef<HTMLDivElement>(null);
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);

  useSpatialNavigation(screenRef);

  const selectedGame = useMemo(
    () => games.find((game) => game.id === selectedId) ?? games[0] ?? null,
    [games, selectedId],
  );

  const pendingDeleteGame = useMemo(
    () => games.find((game) => game.id === pendingDeleteId) ?? null,
    [games, pendingDeleteId],
  );

  // Диалог перехватывает фокус, а карточки/кнопки экрана временно выключены
  // (disabled), чтобы геймпад/клавиатура не «перепрыгивали» через диалог в фон —
  // useSpatialNavigation ищет ближайший [data-nav] по геометрии, не зная про модалки.
  useEffect(() => {
    if (pendingDeleteGame) cancelDeleteRef.current?.focus();
  }, [pendingDeleteGame]);

  function handleDeleteKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      setPendingDeleteId(null);
    }
  }

  async function handleConfirmDelete() {
    if (!pendingDeleteGame) return;
    setDeleting(true);
    try {
      await remove(pendingDeleteGame.id);
      if (selectedId === pendingDeleteGame.id) setSelectedId(null);
    } finally {
      setDeleting(false);
      setPendingDeleteId(null);
    }
  }

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

  const modalOpen = pendingDeleteGame !== null;

  return (
    <div className={styles.screen} ref={screenRef}>
      <aside className={styles.details}>
        {selectedGame ? (
          <>
            <div className={styles.detailsCover} style={coverImageStyle(selectedGame.coverPath)} />
            <h2 className={styles.detailsTitle}>{selectedGame.title}</h2>
            <p className={styles.description}>
              {selectedGame.description ?? "Описание пока не загружено."}
            </p>
            <ul className={styles.meta}>
              <li>{formatLastPlayed(selectedGame.lastPlayedAt)}</li>
              <li>{formatPlaytime(selectedGame.totalPlaytimeSeconds)}</li>
            </ul>
            <div className={styles.detailsActions}>
              <button
                type="button"
                data-nav
                className={styles.playButton}
                onClick={() => onPlay(selectedGame)}
                disabled={modalOpen}
              >
                Играть
              </button>
              <button
                type="button"
                data-nav
                className={styles.deleteButton}
                onClick={() => setPendingDeleteId(selectedGame.id)}
                disabled={modalOpen}
              >
                Удалить игру
              </button>
            </div>
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
              disabled={loading || modalOpen}
            >
              {loading ? "Добавление…" : "Добавить игры"}
            </button>
            <button
              type="button"
              data-nav
              className={styles.settingsButton}
              onClick={onOpenSettings}
              aria-label="Настройки"
              disabled={modalOpen}
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
                disabled={modalOpen}
              />
            ))}
          </div>
        )}
      </section>

      {pendingDeleteGame && (
        <div className={styles.modalBackdrop} onKeyDown={handleDeleteKeyDown}>
          <div className={styles.modal} role="alertdialog" aria-modal="true">
            <h2 className={styles.modalTitle}>Удалить «{pendingDeleteGame.title}»?</h2>
            <p className={styles.modalText}>
              ROM-файл и сохранённые метаданные будут удалены безвозвратно. Это действие нельзя отменить.
            </p>
            <div className={styles.modalActions}>
              <button
                type="button"
                data-nav
                ref={cancelDeleteRef}
                className={styles.ghostButton}
                onClick={() => setPendingDeleteId(null)}
                disabled={deleting}
              >
                Отмена
              </button>
              <button
                type="button"
                data-nav
                className={styles.confirmDeleteButton}
                onClick={handleConfirmDelete}
                disabled={deleting}
              >
                {deleting ? "Удаление…" : "Удалить"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
