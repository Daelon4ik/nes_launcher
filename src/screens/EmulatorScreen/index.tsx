// Экран запущенной игры: канва на весь экран + оверлей (пауза, save/load state, выход),
// скрытый по умолчанию и вызываемый по Tab (клавиатура) / LB (геймпад).
// См. docs/screens.md#3-emulator-screen
import { useEffect, useRef, useState } from "react";
import { Browser } from "jsnes";
import { launchGame, readRomBytes, recordSession } from "../../api/emulator";
import { standardGamepadConfig } from "../../utils/jsnesGamepad";
import { useSpatialNavigation } from "../../hooks/useSpatialNavigation";
import type { Game } from "../../types/game";
import styles from "./EmulatorScreen.module.css";

const LB_BUTTON = 4; // геймпад: не занят jsnes (тот использует только 0,1,8,9,12-15)

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
  const [overlayOpen, setOverlayOpen] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const browserRef = useRef<Browser | null>(null);
  const sessionStartedAt = useRef(Date.now());

  // Оверлей всегда смонтирован (скрывается через display:none), чтобы этот хук
  // навешивал D-pad/A-подтверждение на его кнопки один раз при маунте экрана —
  // когда оверлей скрыт, внутри него ничего не в фокусе, и фокус на скрытый
  // элемент браузер молча не поставит, так что геймплею это не мешает.
  useSpatialNavigation(overlayRef);

  // При открытии фокус обязателен на кнопке оверлея — иначе геймпаду (A/D-pad)
  // не на чем навигировать. Пропускаем disabled-кнопки («Пауза» задизейблена,
  // пока ROM ещё грузится/не запустился) — фокус на disabled-элемент браузер
  // молча не ставит, и без этой проверки оверлей открывался бы совсем без
  // фокуса внутри.
  useEffect(() => {
    if (!overlayOpen) return;
    overlayRef.current?.querySelector<HTMLElement>("[data-nav]:not(:disabled)")?.focus();
  }, [overlayOpen]);

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

  // LB должен открывать оверлей и тогда, когда тот ещё закрыт — опрашиваем
  // геймпад независимо от useSpatialNavigation (та реагирует только пока
  // оверлей виден/в фокусе).
  useEffect(() => {
    let heldLb = false;
    let rafId: number;
    function poll() {
      const pad = navigator.getGamepads?.()[0];
      const pressed = pad?.buttons[LB_BUTTON]?.pressed ?? false;
      if (pressed && !heldLb) setOverlayOpen((open) => !open);
      heldLb = pressed;
      rafId = requestAnimationFrame(poll);
    }
    rafId = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(rafId);
  }, []);

  function handleExit() {
    const durationSeconds = Math.round((Date.now() - sessionStartedAt.current) / 1000);
    recordSession(game.id, durationSeconds).catch((err) =>
      console.error("Не удалось записать игровую сессию:", err),
    );
    onExit();
  }

  // Esc не занят jsnes (там стрелки/X/Z/Y/Enter/Ctrl/S/A) — закрывает оверлей,
  // если он открыт, иначе выход из игры. Tab открывает оверлей, если тот закрыт
  // (пока открыт — Tab работает как обычно, переключая фокус между её кнопками).
  // Стрелки намеренно не перехватываем на самом экране — во время игры D-pad/клавиши
  // должны идти в NES, а не в меню-навигацию (её ловит только сам оверлей, см. выше).
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (overlayOpen) {
          setOverlayOpen(false);
        } else {
          handleExit();
        }
      } else if (e.key === "Tab" && !overlayOpen) {
        e.preventDefault();
        setOverlayOpen(true);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayOpen]);

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

      {!overlayOpen && <p className={styles.overlayHint}>Tab / LB — меню</p>}

      <div
        ref={overlayRef}
        className={overlayOpen ? styles.overlay : `${styles.overlay} ${styles.overlayHidden}`}
      >
        <button
          type="button"
          data-nav
          className={styles.overlayButton}
          onClick={handleTogglePause}
          disabled={status !== "playing"}
        >
          {paused ? "Продолжить" : "Пауза"}
        </button>
        <button type="button" data-nav className={styles.overlayButton} disabled>
          Save state
        </button>
        <button type="button" data-nav className={styles.overlayButton} disabled>
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
