// Экран запущенной игры: область эмулятора + оверлей (пауза, save/load state, выход).
// Само эмулятор-ядро ещё не встроено — см. docs/screens.md#3-emulator-screen
import { useEffect, useRef, useState } from "react";
import { launchGame, recordSession } from "../../api/emulator";
import { useSpatialNavigation } from "../../hooks/useSpatialNavigation";
import type { Game } from "../../types/game";
import styles from "./EmulatorScreen.module.css";

interface EmulatorScreenProps {
  game: Game;
  onExit: () => void;
}

export function EmulatorScreen({ game, onExit }: EmulatorScreenProps) {
  const [romPath, setRomPath] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const sessionStartedAt = useRef(Date.now());

  useSpatialNavigation(screenRef);

  useEffect(() => {
    launchGame(game.id)
      .then(setRomPath)
      .catch((err) => setLoadError(String(err)));
  }, [game.id]);

  // Единственный доступный элемент сейчас — «Выход»; фокус сразу на нём,
  // чтобы geymпад-подтверждение (A/Enter) работало без предварительного Tab.
  useEffect(() => {
    screenRef.current?.querySelector<HTMLElement>("[data-nav]")?.focus();
  }, []);

  function handleExit() {
    const durationSeconds = Math.round((Date.now() - sessionStartedAt.current) / 1000);
    recordSession(game.id, durationSeconds).catch((err) =>
      console.error("Не удалось записать игровую сессию:", err),
    );
    onExit();
  }

  return (
    <div className={styles.screen} ref={screenRef}>
      <div className={styles.stage}>
        <span className={styles.stageBadge}>Эмулятор ещё не встроен</span>
        <h1 className={styles.stageTitle}>{game.title}</h1>
        {loadError ? (
          <p className={styles.stageError}>Не удалось загрузить ROM: {loadError}</p>
        ) : (
          <p className={styles.stagePath}>{romPath ?? "Загрузка…"}</p>
        )}
      </div>

      <div className={styles.overlay}>
        <button type="button" className={styles.overlayButton} disabled>
          Пауза
        </button>
        <button type="button" className={styles.overlayButton} disabled>
          Save state
        </button>
        <button type="button" className={styles.overlayButton} disabled>
          Load state
        </button>
        <button
          type="button"
          data-nav
          className={`${styles.overlayButton} ${styles.exitButton}`}
          onClick={handleExit}
        >
          Выход
        </button>
      </div>
    </div>
  );
}
