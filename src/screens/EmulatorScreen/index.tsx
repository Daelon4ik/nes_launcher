// Экран запущенной игры: область эмулятора (jsnes) + оверлей (пауза, save/load state, выход).
// См. docs/screens.md#3-emulator-screen
import { useEffect, useRef, useState } from "react";
import { Browser } from "jsnes";
import { launchGame, readRomBytes, recordSession } from "../../api/emulator";
import { standardGamepadConfig } from "../../utils/jsnesGamepad";
import type { Game } from "../../types/game";
import styles from "./EmulatorScreen.module.css";

type Status = "loading" | "error" | "playing";

const NES_WIDTH = 256;
const NES_HEIGHT = 240;

// jsnes сам растягивает canvas под размер контейнера (fitInParent), но не
// округляет коэффициент до целого — при дробном масштабе (напр. 4.5×)
// nearest-neighbor скейлинг неравномерно растягивает соседние пиксели, из-за
// чего анимированные спрайты "плывут" полосами/грязью. Пересчитываем размер
// canvas под ближайший целый коэффициент, чтобы каждый NES-пиксель занимал
// одинаковое число экранных пикселей.
function fitScreenPixelPerfect(stage: HTMLDivElement) {
  const canvas = stage.querySelector("canvas");
  if (!canvas) return;
  const scale = Math.max(1, Math.floor(Math.min(stage.clientWidth / NES_WIDTH, stage.clientHeight / NES_HEIGHT)));
  canvas.style.width = `${NES_WIDTH * scale}px`;
  canvas.style.height = `${NES_HEIGHT * scale}px`;
}

interface EmulatorScreenProps {
  game: Game;
  onExit: () => void;
}

export function EmulatorScreen({ game, onExit }: EmulatorScreenProps) {
  const [status, setStatus] = useState<Status>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const browserRef = useRef<Browser | null>(null);
  const sessionStartedAt = useRef(Date.now());

  useEffect(() => {
    let cancelled = false;

    launchGame(game.id)
      .then(readRomBytes)
      .then((romData) => {
        if (cancelled || !stageRef.current) return;
        browserRef.current = new Browser({
          container: stageRef.current,
          romData,
          onError: (err) => {
            setErrorMessage(String(err));
            setStatus("error");
          },
        });
        fitScreenPixelPerfect(stageRef.current);
        setStatus("playing");
      })
      .catch((err) => {
        if (!cancelled) {
          setErrorMessage(String(err));
          setStatus("error");
        }
      });

    return () => {
      cancelled = true;
      browserRef.current?.destroy();
      browserRef.current = null;
    };
  }, [game.id]);

  useEffect(() => {
    if (status !== "playing" || !stageRef.current) return;
    const stage = stageRef.current;
    function handleResize() {
      fitScreenPixelPerfect(stage);
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [status]);

  // jsnes не конфигурирует геймпад сам (ждёт мастер настройки нажатием кнопок) —
  // подключаем стандартный маппинг Gamepad API, чтобы геймпад заработал сразу.
  useEffect(() => {
    function configure(gamepad: Gamepad) {
      browserRef.current?.gamepad.setGamepadConfig(standardGamepadConfig(gamepad.id));
    }
    for (const gamepad of navigator.getGamepads()) {
      if (gamepad) configure(gamepad);
    }
    function handleConnect(e: GamepadEvent) {
      configure(e.gamepad);
    }
    window.addEventListener("gamepadconnected", handleConnect);
    return () => window.removeEventListener("gamepadconnected", handleConnect);
  }, [status]);

  function handleExit() {
    const durationSeconds = Math.round((Date.now() - sessionStartedAt.current) / 1000);
    recordSession(game.id, durationSeconds).catch((err) =>
      console.error("Не удалось записать игровую сессию:", err),
    );
    onExit();
  }

  // Esc не занят jsnes (там стрелки/X/Z/Y/Enter/Ctrl/S/A) — выход с клавиатуры
  // без конфликта с игровым вводом. Стрелки намеренно не перехватываем этим экраном —
  // во время игры D-pad/клавиши должны идти в NES, а не в меню-навигацию.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") handleExit();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleTogglePause() {
    if (!browserRef.current) return;
    if (paused) {
      browserRef.current.start();
    } else {
      browserRef.current.stop();
    }
    setPaused(!paused);
  }

  return (
    <div className={styles.screen}>
      <div className={styles.stageWrapper}>
        <div className={styles.stage} ref={stageRef} />
        {status !== "playing" && (
          <div className={styles.stageOverlayText}>
            {status === "loading" && <p className={styles.stagePath}>Загрузка…</p>}
            {status === "error" && (
              <p className={styles.stageError}>Не удалось загрузить ROM: {errorMessage}</p>
            )}
          </div>
        )}
      </div>

      <div className={styles.overlay}>
        <button
          type="button"
          className={styles.overlayButton}
          onClick={handleTogglePause}
          disabled={status !== "playing"}
        >
          {paused ? "Продолжить" : "Пауза"}
        </button>
        <button type="button" className={styles.overlayButton} disabled>
          Save state
        </button>
        <button type="button" className={styles.overlayButton} disabled>
          Load state
        </button>
        <button
          type="button"
          className={`${styles.overlayButton} ${styles.exitButton}`}
          onClick={handleExit}
        >
          Выход
        </button>
      </div>
    </div>
  );
}
