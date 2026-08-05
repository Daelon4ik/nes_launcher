// Карточка игры в библиотеке: обложка + название. См. docs/design.md#компоненты
// Фокус (клавиатура/геймпад) — он же выбор, см. docs/design.md#управление-с-геймпада.
import type { KeyboardEvent } from "react";
import type { Game } from "../types/game";
import { coverImageStyle } from "../utils/coverImage";
import styles from "./GameCard.module.css";

interface GameCardProps {
  game: Game;
  selected: boolean;
  onSelect: () => void;
  onPlay: () => void;
  disabled?: boolean;
}

export function GameCard({ game, selected, onSelect, onPlay, disabled }: GameCardProps) {
  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onPlay();
    }
  }

  return (
    <button
      type="button"
      data-nav
      disabled={disabled}
      className={selected ? `${styles.card} ${styles.selected}` : styles.card}
      onClick={onSelect}
      onFocus={onSelect}
      onDoubleClick={onPlay}
      onKeyDown={handleKeyDown}
    >
      <span className={styles.cover} style={coverImageStyle(game.coverPath)} />
      <span className={styles.title}>{game.title}</span>
    </button>
  );
}
