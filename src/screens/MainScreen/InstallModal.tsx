import { useState, useMemo } from "react";
import styles from "./MainScreen.module.css";

const STORE_GAMES = [
  { id: "1", title: "1942", playerMode: "coop", dummyPath: "/store/1942.nes" },
  { id: "2", title: "Battle City", playerMode: "coop", dummyPath: "/store/Battle City.nes" },
  { id: "3", title: "Bomberman", playerMode: "single", dummyPath: "/store/Bomberman.nes" },
  { id: "4", title: "Castlevania", playerMode: "single", dummyPath: "/store/Castlevania.nes" },
  { id: "5", title: "Contra", playerMode: "coop", dummyPath: "/store/Contra.nes" },
  { id: "6", title: "Duck Hunt", playerMode: "alternating", dummyPath: "/store/Duck Hunt.nes" },
  { id: "7", title: "Ice Climber", playerMode: "coop", dummyPath: "/store/Ice Climber.nes" },
  { id: "8", title: "Metroid", playerMode: "single", dummyPath: "/store/Metroid.nes" },
  { id: "9", title: "Super Mario Bros", playerMode: "alternating", dummyPath: "/store/Super Mario Bros.nes" },
];

interface InstallModalProps {
  onClose: () => void;
  onInstall: (paths: string[]) => void;
}

export function InstallModal({ onClose, onInstall }: InstallModalProps) {
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [filterMode, setFilterMode] = useState<"all" | "single" | "alternating" | "coop">("all");

  const filteredAndSortedGames = useMemo(() => {
    let result = STORE_GAMES.filter((g) => filterMode === "all" || g.playerMode === filterMode);
    
    result.sort((a, b) => {
      const cmp = a.title.localeCompare(b.title);
      return sortOrder === "asc" ? cmp : -cmp;
    });

    return result;
  }, [sortOrder, filterMode]);

  return (
    <div className={styles.modalBackdrop}>
      <div className={styles.modal} style={{ width: 600, maxWidth: "90vw", maxHeight: "90vh", display: "flex", flexDirection: "column" }} role="dialog" aria-modal="true">
        <h2 className={styles.modalTitle}>Магазин игр (Демо)</h2>
        
        <div style={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
          <select 
            className={styles.filterSelect} 
            value={sortOrder} 
            onChange={(e) => setSortOrder(e.target.value as any)}
          >
            <option value="asc">По алфавиту (A-Z, 0-9)</option>
            <option value="desc">По алфавиту (Z-A, 9-0)</option>
          </select>
          <select 
            className={styles.filterSelect} 
            value={filterMode} 
            onChange={(e) => setFilterMode(e.target.value as any)}
          >
            <option value="all">Все режимы</option>
            <option value="coop">2 игрока (кооп)</option>
            <option value="alternating">2 игрока (по очереди)</option>
            <option value="single">1 игрок</option>
          </select>
        </div>

        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "10px", marginBottom: "20px" }}>
          {filteredAndSortedGames.length === 0 ? (
             <p className={styles.empty}>Ничего не найдено</p>
          ) : (
            filteredAndSortedGames.map(game => (
              <div key={game.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px", background: "var(--color-panel-hover)", borderRadius: "var(--radius-md)" }}>
                <div>
                  <strong style={{ display: "block" }}>{game.title}</strong>
                  <span style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                    {game.playerMode === "single" ? "1 игрок" : game.playerMode === "alternating" ? "2 игрока (по очереди)" : "2 игрока (кооп)"}
                  </span>
                </div>
                <button 
                  type="button" 
                  className={styles.playButton} 
                  style={{ height: "30px", padding: "0 15px", fontSize: "14px" }}
                  onClick={() => {
                    onInstall([game.dummyPath]);
                    onClose();
                  }}
                >
                  Установить
                </button>
              </div>
            ))
          )}
        </div>

        <div className={styles.modalActions}>
          <button type="button" className={styles.ghostButton} onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
