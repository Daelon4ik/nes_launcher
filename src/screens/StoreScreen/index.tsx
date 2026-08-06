// Магазин игр: поиск/просмотр ROM'ов на emu-land.net и установка в библиотеку.
// См. docs/screens.md#5-store-screen и docs/store.md
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Gamepad2, Library, Settings, Store } from "lucide-react";
import { useGameLibrary } from "../../hooks/useGameLibrary";
import { useSpatialNavigation } from "../../hooks/useSpatialNavigation";
import { getRomLibraryPaths } from "../../api/settings";
import { storeBrowse, storeInstall, storeListFiles, storeSearch } from "../../api/store";
import { BROWSE_LETTERS, type StoreFile, type StoreGameSummary } from "../../types/store";
import styles from "./StoreScreen.module.css";

interface StoreScreenProps {
  onBack: () => void;
  onOpenSettings: () => void;
}

// Не бьём поисковый запрос в бэкенд на каждое нажатие клавиши.
const SEARCH_DEBOUNCE_MS = 400;

export function StoreScreen({ onBack, onOpenSettings }: StoreScreenProps) {
  const { loading: installingLocal, install: installLocal } = useGameLibrary();
  const screenRef = useRef<HTMLDivElement>(null);
  useSpatialNavigation(screenRef);

  const [libraryPaths, setLibraryPaths] = useState<string[]>([]);
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [letter, setLetter] = useState<string>("a");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [games, setGames] = useState<StoreGameSummary[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedGame, setSelectedGame] = useState<StoreGameSummary | null>(null);
  const [files, setFiles] = useState<StoreFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);

  const [pendingInstall, setPendingInstall] = useState<StoreFile | null>(null);
  const [installingFid, setInstallingFid] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [installedMessage, setInstalledMessage] = useState<string | null>(null);

  const isSearching = query.trim().length > 0;
  const anyModalOpen = selectedGame !== null || pendingInstall !== null;

  useEffect(() => {
    getRomLibraryPaths()
      .then(setLibraryPaths)
      .catch((err) => console.error("Не удалось получить папки библиотеки:", err));
  }, []);

  // Debounce: обновляем реальный поисковый запрос спустя паузу в наборе текста.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(queryInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [queryInput]);

  useEffect(() => {
    let cancelled = false;
    setListLoading(true);
    setListError(null);

    const request = isSearching ? storeSearch(query.trim()) : storeBrowse(letter, page);

    request
      .then((result) => {
        if (cancelled) return;
        if (isSearching) {
          setGames(result as StoreGameSummary[]);
          setTotalPages(1);
        } else {
          const listing = result as { games: StoreGameSummary[]; totalPages: number };
          setGames(listing.games);
          setTotalPages(listing.totalPages);
        }
      })
      .catch((err) => {
        if (!cancelled) setListError(String(err));
      })
      .finally(() => {
        if (!cancelled) setListLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isSearching, query, letter, page]);

  // Смена буквы сбрасывает страницу — иначе можно застрять на, скажем, странице 5,
  // если у новой буквы столько страниц нет.
  function handleLetterChange(next: string) {
    setLetter(next);
    setPage(1);
  }

  // Геймпад/клавиатура должны иметь что-то в фокусе сразу, без предварительного Tab.
  useEffect(() => {
    const container = screenRef.current;
    if (!container || anyModalOpen) return;
    if (container.contains(document.activeElement)) return;
    container.querySelector<HTMLElement>("[data-nav]")?.focus();
  }, [games, anyModalOpen]);

  function openGame(game: StoreGameSummary) {
    setSelectedGame(game);
    setFiles([]);
    setFilesError(null);
    setInstallError(null);
    setFilesLoading(true);
    storeListFiles(game.slug)
      .then(setFiles)
      .catch((err) => setFilesError(String(err)))
      .finally(() => setFilesLoading(false));
  }

  function closeGame() {
    setSelectedGame(null);
    setPendingInstall(null);
  }

  function handleModalKeyDown(e: KeyboardEvent<HTMLDivElement>, onCancel: () => void) {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  }

  function handleInstallClick(file: StoreFile) {
    setInstallError(null);
    if (libraryPaths.length > 1) {
      setPendingInstall(file);
    } else {
      runInstall(file, libraryPaths[0] ?? null);
    }
  }

  function runInstall(file: StoreFile, targetDir: string | null) {
    if (!selectedGame) return;
    setPendingInstall(null);
    setInstallingFid(file.fid);
    setInstallError(null);
    storeInstall(selectedGame.slug, file.fid, selectedGame.title, targetDir)
      .then(() => {
        setInstalledMessage(`«${selectedGame.title}» установлена в библиотеку`);
      })
      .catch((err) => setInstallError(String(err)))
      .finally(() => setInstallingFid(null));
  }

  async function handleAddGames() {
    const selected = await open({
      multiple: true,
      filters: [{ name: "NES ROM", extensions: ["nes"] }],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    await installLocal(paths);
  }

  const letterLabel = useMemo(() => letter.toUpperCase(), [letter]);

  return (
    <div className={styles.screen} ref={screenRef}>
      <div className={styles.content}>
        <header className={styles.topBar}>
          <nav className={styles.navTabs}>
            <button
              type="button"
              data-nav
              className={styles.navTab}
              onClick={onBack}
              disabled={anyModalOpen}
            >
              <Library size={24} />
              Библиотека
            </button>
            <span className={`${styles.navTab} ${styles.navTabActive}`}>
              <Store size={24} />
              Магазин
            </span>
            <button
              type="button"
              data-nav
              className={styles.navTab}
              onClick={onOpenSettings}
              disabled={anyModalOpen}
            >
              <Settings size={24} />
              Настройки
            </button>
          </nav>

          <div className={styles.headerControls}>
            <input
              type="search"
              data-nav
              className={styles.searchInput}
              placeholder="Название игры…"
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              disabled={anyModalOpen}
            />
            <button
              type="button"
              data-nav
              className={styles.ghostButton}
              onClick={handleAddGames}
              disabled={installingLocal || anyModalOpen}
            >
              {installingLocal ? "Добавление…" : "Добавить игры"}
            </button>
          </div>
        </header>

        {!isSearching && (
          <nav className={styles.letters}>
            {BROWSE_LETTERS.map((l) => (
              <button
                key={l}
                type="button"
                data-nav
                className={l === letter ? `${styles.letter} ${styles.letterActive}` : styles.letter}
                onClick={() => handleLetterChange(l)}
                disabled={anyModalOpen}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </nav>
        )}

        <main className={styles.gridArea}>
          {installedMessage && <p className={styles.success}>{installedMessage}</p>}
          {listError && <p className={styles.error}>{listError}</p>}

          {!listLoading && !listError && games.length === 0 && (
            <p className={styles.empty}>
              {isSearching
                ? "Ничего не найдено. Попробуйте другое название или просмотрите раздел по буквам."
                : `В разделе «${letterLabel}» пока пусто.`}
            </p>
          )}

          <div className={styles.grid}>
            {games.map((game) => (
              <button
                key={game.slug}
                type="button"
                data-nav
                className={styles.tile}
                onClick={() => openGame(game)}
                disabled={anyModalOpen}
              >
                <span className={styles.tileCover}>
                  <Gamepad2 size={32} strokeWidth={1.5} />
                </span>
                <span className={styles.tileTitle}>{game.title}</span>
              </button>
            ))}
          </div>

        </main>

        {!isSearching && totalPages > 1 && (
          <div className={styles.pagination}>
            <button
              type="button"
              data-nav
              className={styles.ghostButton}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || anyModalOpen}
            >
              ← Назад
            </button>
            <span className={styles.pageIndicator}>
              Страница {page} из {totalPages}
            </span>
            <button
              type="button"
              data-nav
              className={styles.ghostButton}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || anyModalOpen}
            >
              Далее →
            </button>
          </div>
        )}

        <footer className={styles.hintFooter}>
          {anyModalOpen ? (
            <>
              <span className={styles.hint}>
                <span className={styles.hintBadge}>A</span> Подтвердить
              </span>
              <span className={styles.hint}>
                <span className={styles.hintBadge}>Esc</span> Отмена
              </span>
            </>
          ) : (
            <>
              <span className={styles.hint}>
                <span className={styles.hintBadge}>A</span> Выбрать
              </span>
              <span className={styles.hint}>
                <span className={styles.hintBadge}>↑↓←→</span> Навигация
              </span>
            </>
          )}
        </footer>
      </div>

      {selectedGame && (
        <div className={styles.modalBackdrop} onKeyDown={(e) => handleModalKeyDown(e, closeGame)}>
          <div className={styles.modal} role="dialog" aria-modal="true">
            <h2 className={styles.modalTitle}>{selectedGame.title}</h2>

            {filesLoading && <p className={styles.empty}>Загрузка списка файлов…</p>}
            {filesError && <p className={styles.error}>{filesError}</p>}
            {installError && <p className={styles.error}>{installError}</p>}

            {!filesLoading && !filesError && files.length === 0 && (
              <p className={styles.empty}>Файлов для скачивания не найдено.</p>
            )}

            <div className={styles.fileList}>
              {files.map((file) => (
                <div key={file.fid} className={styles.fileRow}>
                  <div className={styles.fileInfo}>
                    <strong className={styles.fileName}>{file.name}</strong>
                    <span className={styles.fileMeta}>
                      {file.section}
                      {file.size ? ` · ${file.size}` : ""}
                    </span>
                  </div>
                  <button
                    type="button"
                    data-nav
                    className={styles.installButton}
                    onClick={() => handleInstallClick(file)}
                    disabled={installingFid !== null || pendingInstall !== null}
                  >
                    {installingFid === file.fid ? "Установка…" : "Установить"}
                  </button>
                </div>
              ))}
            </div>

            <div className={styles.modalActions}>
              <button type="button" data-nav className={styles.ghostButton} onClick={closeGame}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingInstall && (
        <div className={styles.modalBackdrop} onKeyDown={(e) => handleModalKeyDown(e, () => setPendingInstall(null))}>
          <div className={styles.modal} role="dialog" aria-modal="true">
            <h2 className={styles.modalTitle}>Куда установить?</h2>
            <p className={styles.modalText}>Настроено несколько папок с ROM'ами — выберите нужную.</p>
            <div className={styles.pathList}>
              {libraryPaths.map((path) => (
                <button
                  key={path}
                  type="button"
                  data-nav
                  className={styles.pathButton}
                  onClick={() => runInstall(pendingInstall, path)}
                >
                  {path}
                </button>
              ))}
            </div>
            <div className={styles.modalActions}>
              <button
                type="button"
                data-nav
                className={styles.ghostButton}
                onClick={() => setPendingInstall(null)}
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
