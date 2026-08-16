// Главный экран (Big Picture): фон-герой выбранной игры, полки библиотеки снизу.
// См. docs/screens.md#1-main-screen, docs/design.md
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Shelf } from "../../components/Shelf";
import { Library, Settings, Star, Store } from "lucide-react";
import { useGameLibrary } from "../../hooks/useGameLibrary";
import { useSpatialNavigation } from "../../hooks/useSpatialNavigation";
import type { Game } from "../../types/game";
import { coverImageStyle, coverImageSrc } from "../../utils/coverImage";
import logo from "../../assets/logo.png";
import styles from "./MainScreen.module.css";

// «Недавно запущенные» — витрина, а не полный список: без лимита при большой
// библиотеке полка стала бы неотличима от «Все игры».
const RECENT_LIMIT = 15;
// Пауза перед подстановкой нового фона — даёт кадру со старой обложкой уйти в
// opacity:0 до подмены src, иначе смена была бы мгновенной сменой картинки под
// уже гаснущей прозрачностью (см. docs/design.md#анимации, crossfade 250ms).
const HERO_FADE_MS = 150;

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

function formatPlayerMode(mode: Game["playerMode"]): string {
  switch (mode) {
    case "single":
      return "1 игрок";
    case "alternating":
      return "2 игрока (по очереди)";
    case "coop":
      return "2 игрока (кооп)";
    default:
      return "Неизвестно";
  }
}

interface MainScreenProps {
  onOpenSettings: () => void;
  onOpenStore: () => void;
  onPlay: (game: Game) => void;
  onCoop: (game: Game) => void;
}

export function MainScreen({ onOpenSettings, onOpenStore, onPlay, onCoop }: MainScreenProps) {
  const { games, loading, error, install, remove, toggleFavorite } = useGameLibrary();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [infoModalGame, setInfoModalGame] = useState<Game | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [filterMode, setFilterMode] = useState<"all" | "single" | "alternating" | "coop">("all");
  const [platformFilter, setPlatformFilter] = useState<Game["platform"]>("nes");
  const screenRef = useRef<HTMLDivElement>(null);
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);

  useSpatialNavigation(screenRef);

  const filteredGames = useMemo(
    () =>
      games.filter(
        (game) =>
          (filterMode === "all" || game.playerMode === filterMode) && game.platform === platformFilter,
      ),
    [games, filterMode, platformFilter],
  );

  const favoriteGames = useMemo(
    () => filteredGames.filter((game) => game.favorite),
    [filteredGames],
  );

  const recentGames = useMemo(
    () =>
      filteredGames
        .filter((game) => game.lastPlayedAt)
        .sort((a, b) => new Date(b.lastPlayedAt!).getTime() - new Date(a.lastPlayedAt!).getTime())
        .slice(0, RECENT_LIMIT),
    [filteredGames],
  );

  const selectedGame = useMemo(
    () =>
      filteredGames.find((game) => game.id === selectedId) ?? recentGames[0] ?? filteredGames[0] ?? null,
    [filteredGames, recentGames, selectedId],
  );

  const pendingDeleteGame = useMemo(
    () => games.find((game) => game.id === pendingDeleteId) ?? null,
    [games, pendingDeleteId],
  );

  const modalOpen = pendingDeleteGame !== null || infoModalGame !== null;

  // Фон-герой: обложка игры в фокусе на весь экран. Меняется crossfade'ом, а не
  // мгновенно — гасим текущий кадр, подставляем новую картинку, включаем обратно
  // (см. docs/design.md#анимации). Простая одноуровневая реализация: без второго
  // слоя под нижним кадром экран на HERO_FADE_MS показывает сплошной фон вместо
  // истинного двухслойного кроссфейда — заметно проще в коде и достаточно похоже
  // визуально при этой длительности.
  const [heroCover, setHeroCover] = useState<string | null>(null);
  const [heroVisible, setHeroVisible] = useState(true);
  useEffect(() => {
    const nextCover = selectedGame?.coverPath ?? null;
    if (nextCover === heroCover) return;
    setHeroVisible(false);
    const timer = setTimeout(() => {
      setHeroCover(nextCover);
      setHeroVisible(true);
    }, HERO_FADE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGame?.coverPath]);

  // Диалог перехватывает фокус, а остальные элементы экрана временно выключены
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



  // Геймпад/клавиатура должны иметь что-то в фокусе сразу, без предварительного Tab —
  // первая карточка первой полки, а не элемент верхней навигации.
  useEffect(() => {
    const container = screenRef.current;
    if (!container || filteredGames.length === 0) return;
    if (container.contains(document.activeElement)) return;
    container.querySelector<HTMLElement>(`.${styles.shelves} [data-nav]`)?.focus();
  }, [filteredGames]);

  return (
    <div className={styles.screen} ref={screenRef}>
      <div className={styles.heroLayer} aria-hidden="true">
        <div
          className={styles.heroBackdrop}
          style={{
            ...coverImageStyle(heroCover),
            "--bg-image": heroCover ? `url("${coverImageSrc(heroCover)}")` : "none",
            opacity: heroVisible ? 1 : 0,
          } as React.CSSProperties}
        />
        <div className={styles.heroScrim} />
      </div>

      <div className={styles.content}>
        <header className={styles.topBar}>
          <div className={styles.leftNav}>
            <img src={logo} alt="dlemu" className={styles.logo} />
            <nav className={styles.navTabs}>
              <span className={`${styles.navTab} ${styles.navTabActive}`}>
                <Library size={24} />
                Библиотека
              </span>
              <button
                type="button"
                data-nav
                className={styles.navTab}
                onClick={onOpenStore}
                disabled={modalOpen}
              >
                <Store size={24} />
                Магазин
              </button>
              <button
                type="button"
                data-nav
                className={styles.navTab}
                onClick={onOpenSettings}
                disabled={modalOpen}
              >
                <Settings size={24} />
                Настройки
              </button>
            </nav>
          </div>

          <div className={styles.headerControls}>
            <div className={styles.platformToggle}>
              <button
                type="button"
                data-nav
                className={
                  platformFilter === "nes"
                    ? `${styles.platformButton} ${styles.platformButtonActive}`
                    : styles.platformButton
                }
                onClick={() => setPlatformFilter("nes")}
                disabled={loading || modalOpen}
              >
                NES
              </button>
              <button
                type="button"
                data-nav
                className={
                  platformFilter === "genesis"
                    ? `${styles.platformButton} ${styles.platformButtonActive}`
                    : styles.platformButton
                }
                onClick={() => setPlatformFilter("genesis")}
                disabled={loading || modalOpen}
              >
                Genesis
              </button>
            </div>

            <select
              className={styles.filterSelect}
              value={filterMode}
              onChange={(e) => setFilterMode(e.target.value as any)}
              disabled={loading || modalOpen}
              data-nav
            >
              <option value="all">Все игры</option>
              <option value="coop">Кооп (2 игрока)</option>
              <option value="alternating">По очереди (2 игрока)</option>
              <option value="single">Соло игра</option>
            </select>

          </div>
        </header>

        <div className={styles.heroInfo}>
          {selectedGame ? (
            <>
              <h1 className={styles.heroTitle}>{selectedGame.title}</h1>
              <div className={styles.heroMeta}>
                <span>{formatPlayerMode(selectedGame.playerMode)}</span>
                <span>{formatLastPlayed(selectedGame.lastPlayedAt)}</span>
                <span>{formatPlaytime(selectedGame.totalPlaytimeSeconds)}</span>
              </div>
              <div className={styles.heroActions}>
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
                  className={styles.coopButton}
                  onClick={() => onCoop(selectedGame)}
                  disabled={modalOpen || selectedGame.playerMode === "single"}
                  title={selectedGame.playerMode === "single" ? "Игра только для одного игрока" : undefined}
                >
                  Кооп
                </button>
                <button
                  type="button"
                  data-nav
                  className={styles.infoButton}
                  onClick={() => setInfoModalGame(selectedGame)}
                  disabled={modalOpen}
                >
                  Об игре
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
                <button
                  type="button"
                  data-nav
                  className={
                    selectedGame.favorite
                      ? `${styles.favoriteButton} ${styles.favoriteActive}`
                      : styles.favoriteButton
                  }
                  onClick={() => toggleFavorite(selectedGame.id, !selectedGame.favorite)}
                  disabled={modalOpen}
                  title={selectedGame.favorite ? "Убрать из избранного" : "Добавить в избранное"}
                >
                  <Star size={20} fill={selectedGame.favorite ? "currentColor" : "none"} />
                </button>
              </div>
            </>
          ) : (
            <p className={styles.empty}>
              {loading ? "Загрузка библиотеки…" : "Библиотека пуста — добавьте игры, чтобы начать"}
            </p>
          )}
        </div>

        {error && <p className={styles.error}>{error}</p>}

        <main className={styles.shelves}>
          {!loading && filteredGames.length === 0 ? (
            <p className={styles.empty}>Библиотека пуста или нет игр, подходящих под фильтр.</p>
          ) : (
            <>
              <Shelf
                title="Избранное"
                games={favoriteGames}
                selectedId={selectedGame?.id}
                onSelect={(game) => setSelectedId(game.id)}
                onPlay={onPlay}
                disabled={modalOpen}
                wrap
              />
              <Shelf
                title="Недавно запущенные"
                games={recentGames}
                selectedId={selectedGame?.id}
                onSelect={(game) => setSelectedId(game.id)}
                onPlay={onPlay}
                disabled={modalOpen}
                wrap
              />
              <Shelf
                title="Все игры"
                games={filteredGames}
                selectedId={selectedGame?.id}
                onSelect={(game) => setSelectedId(game.id)}
                onPlay={onPlay}
                disabled={modalOpen}
                wrap
              />
            </>
          )}
        </main>

        <footer className={styles.hintFooter}>
          {modalOpen ? (
            <>
              <span className={styles.hint}>
                <span className={styles.hintBadge}>A</span> Удалить
              </span>
              <span className={styles.hint}>
                <span className={styles.hintBadge}>Esc</span> Отмена
              </span>
            </>
          ) : (
            <>
              <span className={styles.hint}>
                <span className={styles.hintBadge}>A</span> Подтвердить
              </span>
              <span className={styles.hint}>
                <span className={styles.hintBadge}>↑↓←→</span> Навигация
              </span>
            </>
          )}
        </footer>
      </div>

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

      {infoModalGame && (
        <div className={styles.modalBackdrop} onKeyDown={(e) => {
          if (e.key === "Escape") setInfoModalGame(null);
        }}>
          <div className={styles.modal} role="dialog" aria-modal="true">
            <h2 className={styles.modalTitle}>{infoModalGame.title}</h2>
            <p className={styles.modalText}>
              {infoModalGame.description || "Описание отсутствует."}
            </p>
            <div className={styles.modalActions}>
              <button
                type="button"
                data-nav
                className={styles.ghostButton}
                onClick={() => setInfoModalGame(null)}
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
