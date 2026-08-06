// Экран запущенной игры: канва на весь экран + оверлей (пауза, save/load state, выход),
// скрытый по умолчанию и вызываемый по Tab (клавиатура) / LB (геймпад).
// См. docs/screens.md#4-emulator-screen
import { useEffect, useRef, useState } from "react";
import { Browser } from "jsnes";
import { launchGame, readRomBytes, recordSession } from "../../api/emulator";
import { listSaveSlots, loadState, saveState, type SaveSlot } from "../../api/saves";
import { disconnect as disconnectNetplay } from "../../api/netplay";
import { NetplayEngine } from "../../netplay/engine";
import { getGamepadButtonMaps } from "../../utils/jsnesGamepad";
import { getJsnesKeysConfig } from "../../utils/keyboardControls";
import { useSpatialNavigation } from "../../hooks/useSpatialNavigation";
import type { Game } from "../../types/game";
import type { NetplaySession } from "../../types/netplay";
import styles from "./EmulatorScreen.module.css";

const LB_BUTTON = 4; // геймпад: не занят jsnes (тот использует только 0,1,8,9,12-15)

type Status = "loading" | "error" | "playing";
type OverlayView = "menu" | "save" | "load";

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
  netplay?: NetplaySession | null;
  onExit: () => void;
}

export function EmulatorScreen({ game, netplay, onExit }: EmulatorScreenProps) {
  const [status, setStatus] = useState<Status>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [overlayView, setOverlayView] = useState<OverlayView>("menu");
  const [slots, setSlots] = useState<SaveSlot[] | null>(null);
  const [slotError, setSlotError] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const browserRef = useRef<Browser | null>(null);
  const netplayEngineRef = useRef<NetplayEngine | null>(null);
  const sessionStartedAt = useRef(Date.now());

  // Оверлей всегда смонтирован (скрывается через display:none), чтобы этот хук
  // навешивал D-pad/A-подтверждение на его кнопки один раз при маунте экрана —
  // когда оверлей скрыт, внутри него ничего не в фокусе, и фокус на скрытый
  // элемент браузер молча не поставит, так что геймплею это не мешает.
  useSpatialNavigation(overlayRef);

  // Закрытие оверлея сбрасывает подменю save/load обратно на главный список —
  // иначе повторное открытие (Tab/LB) показывало бы слоты прошлого раза.
  useEffect(() => {
    if (overlayOpen) return;
    setOverlayView("menu");
    setSlots(null);
    setSlotError(null);
  }, [overlayOpen]);

  // При открытии (и при переключении между главным меню и подменю слотов)
  // фокус обязателен на кнопке оверлея — иначе геймпаду (A/D-pad) не на чем
  // навигировать. Пропускаем disabled-кнопки («Пауза» задизейблена, пока ROM
  // ещё грузится/не запустился) — фокус на disabled-элемент браузер молча не
  // ставит, и без этой проверки оверлей открывался бы совсем без фокуса внутри.
  useEffect(() => {
    if (!overlayOpen) return;
    overlayRef.current?.querySelector<HTMLElement>("[data-nav]:not(:disabled)")?.focus();
  }, [overlayOpen, overlayView]);

  function openSlotMenu(view: "save" | "load") {
    setOverlayView(view);
    setSlots(null);
    setSlotError(null);
    listSaveSlots(game.id)
      .then(setSlots)
      .catch((err) => setSlotError(String(err)));
  }

  async function handleSaveToSlot(slot: number) {
    if (!browserRef.current) return;
    try {
      const data = JSON.stringify(browserRef.current.nes.toJSON());
      await saveState(game.id, slot, data);
      setSlots(await listSaveSlots(game.id));
    } catch (err) {
      setSlotError(String(err));
    }
  }

  async function handleLoadFromSlot(slot: number) {
    if (!browserRef.current) return;
    try {
      const data = await loadState(game.id, slot);
      browserRef.current.nes.fromJSON(JSON.parse(data));
      setOverlayOpen(false);
    } catch (err) {
      setSlotError(String(err));
    }
  }

  useEffect(() => {
    let cancelled = false;

    if (netplay) {
      // ROM уже прочитан в лобби (там же проверена чек-сумма с партнёром) —
      // повторно читать не нужно, к тому же движок должен грузить ровно те же
      // байты, что были захэшированы, без риска рассинхрона из-за гонки.
      if (!stageRef.current) return;
      netplayEngineRef.current = new NetplayEngine({
        container: stageRef.current,
        romData: netplay.romData,
        localPlayer: netplay.localPlayer,
        onError: (err) => {
          if (cancelled) return;
          setErrorMessage(String(err));
          setStatus("error");
        },
        onPeerDisconnected: () => {
          if (cancelled) return;
          setErrorMessage("Партнёр отключился.");
          setStatus("error");
        },
      });
      fitScreenPixelPerfect(stageRef.current);
      setStatus("playing");

      return () => {
        cancelled = true;
        netplayEngineRef.current?.destroy();
        netplayEngineRef.current = null;
        disconnectNetplay().catch(() => {});
      };
    }

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
        // Применяем сохраненные настройки управления клавиатурой
        browserRef.current.keyboard.setKeys(getJsnesKeysConfig());

        // jsnes по умолчанию отключает клавиатуру для игрока, если к нему привязан геймпад.
        // Переопределяем коллбеки клавиатуры, чтобы она работала всегда, независимо от геймпадов.
        browserRef.current.keyboard.onButtonDown = browserRef.current.nes.buttonDown;
        browserRef.current.keyboard.onButtonUp = browserRef.current.nes.buttonUp;

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id, netplay]);

  useEffect(() => {
    if (status !== "playing" || !stageRef.current) return;
    const stage = stageRef.current;
    function handleResize() {
      fitScreenPixelPerfect(stage);
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [status]);

  // jsnes не конфигурирует геймпад сам (ждёт мастер настройки нажатием кнопок), а его
  // встроенный GamepadController привязывает раскладку по строковому id устройства —
  // это не различает двух игроков с одинаковой моделью контроллера (у обеих один и тот
  // же id). Поэтому опрашиваем геймпады сами и применяем сохранённую раскладку
  // (см. src/utils/jsnesGamepad.ts) напрямую через nes.buttonDown/buttonUp, назначая
  // игроков по порядку подключения — первый геймпад Игроку 1, второй Игроку 2.
  useEffect(() => {
    if (status !== "playing" || netplay) return; // кооп читает ввод сам (LocalInputReader)
    const maps = getGamepadButtonMaps();
    const prevPressed: boolean[][] = [[], []];
    let rafId: number;

    function poll() {
      const pads = Array.from(navigator.getGamepads()).filter((p): p is Gamepad => p !== null);
      const nes = browserRef.current?.nes;
      for (let i = 0; i < 2; i++) {
        const pad = pads[i];
        if (!pad || !nes) {
          prevPressed[i] = [];
          continue;
        }
        for (const [buttonIndex, nesButton] of maps[i]) {
          const pressed = pad.buttons[buttonIndex]?.pressed ?? false;
          const wasPressed = prevPressed[i][buttonIndex] ?? false;
          if (pressed && !wasPressed) nes.buttonDown((i + 1) as 1 | 2, nesButton);
          else if (!pressed && wasPressed) nes.buttonUp((i + 1) as 1 | 2, nesButton);
        }
        prevPressed[i] = pad.buttons.map((b) => b.pressed);
      }
      rafId = requestAnimationFrame(poll);
    }
    rafId = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(rafId);
  }, [status, netplay]);

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
        if (overlayOpen && overlayView !== "menu") {
          setOverlayView("menu");
        } else if (overlayOpen) {
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
  }, [overlayOpen, overlayView]);

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
              <p className={styles.stageError}>
                {netplay ? errorMessage : `Не удалось загрузить ROM: ${errorMessage}`}
              </p>
            )}
          </div>
        )}
      </div>

      {!overlayOpen && <p className={styles.overlayHint}>Tab / LB — меню</p>}

      <div
        ref={overlayRef}
        className={overlayOpen ? styles.overlay : `${styles.overlay} ${styles.overlayHidden}`}
      >
        {overlayView === "menu" && (
          <>
            <button
              type="button"
              data-nav
              className={styles.overlayButton}
              onClick={handleTogglePause}
              disabled={status !== "playing" || Boolean(netplay)}
              title={netplay ? "Пауза недоступна в кооп-режиме" : undefined}
            >
              {paused ? "Продолжить" : "Пауза"}
            </button>
            <button
              type="button"
              data-nav
              className={styles.overlayButton}
              onClick={() => openSlotMenu("save")}
              disabled={status !== "playing" || Boolean(netplay)}
              title={netplay ? "Save state недоступен в кооп-режиме" : undefined}
            >
              Save state
            </button>
            <button
              type="button"
              data-nav
              className={styles.overlayButton}
              onClick={() => openSlotMenu("load")}
              disabled={status !== "playing" || Boolean(netplay)}
              title={netplay ? "Load state недоступен в кооп-режиме" : undefined}
            >
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
          </>
        )}

        {overlayView !== "menu" && (
          <div className={styles.slotMenu}>
            <p className={styles.slotMenuTitle}>
              {overlayView === "save" ? "Сохранить в слот" : "Загрузить слот"}
            </p>
            <div className={styles.slotList}>
              {slots === null && <p className={styles.slotStatus}>Загрузка…</p>}
              {slots?.map((s) => (
                <button
                  key={s.slot}
                  type="button"
                  data-nav
                  className={styles.overlayButton}
                  disabled={overlayView === "load" && !s.createdAt}
                  onClick={() => (overlayView === "save" ? handleSaveToSlot(s.slot) : handleLoadFromSlot(s.slot))}
                >
                  Слот {s.slot} — {s.createdAt ? new Date(s.createdAt).toLocaleString("ru-RU") : "пусто"}
                </button>
              ))}
            </div>
            {slotError && <p className={styles.stageError}>{slotError}</p>}
            <button type="button" data-nav className={styles.overlayButton} onClick={() => setOverlayView("menu")}>
              Назад
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
