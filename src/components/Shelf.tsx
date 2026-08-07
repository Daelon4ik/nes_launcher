// Горизонтальная полка игр (Big Picture-раскладка Main Screen).
// См. docs/design.md#компоненты
import { GameCard } from "./GameCard";
import type { Game } from "../types/game";
import styles from "./Shelf.module.css";

interface ShelfProps {
  title: string;
  games: Game[];
  selectedId: number | undefined;
  onSelect: (game: Game) => void;
  onPlay: (game: Game) => void;
  disabled?: boolean;
  wrap?: boolean;
}

export function Shelf({ title, games, selectedId, onSelect, onPlay, disabled, wrap }: ShelfProps) {
  if (games.length === 0) return null;

  return (
    <section className={styles.shelf}>
      <h2 className={styles.title}>{title}</h2>
      <div className={wrap ? `${styles.row} ${styles.rowWrap}` : styles.row}>
        {games.map((game) => (
          <div key={game.id} className={styles.tile}>
            <GameCard
              game={game}
              selected={game.id === selectedId}
              onSelect={() => onSelect(game)}
              onPlay={() => onPlay(game)}
              disabled={disabled}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
