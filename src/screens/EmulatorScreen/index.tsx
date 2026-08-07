// Экран запущенной игры: канва на весь экран + оверлей (пауза, save/load state, выход),
// скрытый по умолчанию и вызываемый по Tab (клавиатура) / LB (геймпад).
// См. docs/screens.md#4-emulator-screen
import { useEffect, useRef, useState } from "react";
import { Browser } from "jsnes";
import { launchGame, readRomBytes, recordSession } from "../../api/emulator";
import { listSaveSlots, loadState, saveState, type SaveSlot } from "../../api/saves";
import {
  disconnect as disconnectNetplay,
  sendInput as sendNetplayInput,
  steamDisconnect,
  steamSendInput,
} from "../../api/netplay";
import { NetplayEngine } from "../../netplay/engine";
import { getGamepadButtonMaps } from "../../utils/jsnesGamepad";
import { getCodeBasedKeyMap } from "../../utils/keyboardControls";
import { getGenesisCodeBasedKeyMap, type GenesisActionName } from "../../utils/genesisControls";
import { getGenesisGamepadButtonMaps } from "../../utils/genesisGamepad";
import { isAxisPressed } from "../../utils/gamepadInput";
import { useSpatialNavigation } from "../../hooks/useSpatialNavigation";
import { getVolume } from "../../api/settings";
import { GenesisCore, genesisStateFromBase64, genesisStateToBase64, type GenesisButtons } from "../../emulator/genesis/GenesisCore";
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
// canvas под ближайший целый коэффициент, чтобы каждый пиксель эмулятора занимал
// одинаковое число экранных пикселей (используется и для NES, и для Genesis).
function fitScreenPixelPerfect(stage: HTMLDivElement, width: number, height: number) {
  const canvas = stage.querySelector("canvas");
  if (!canvas) return;
  const scale = Math.max(1, Math.floor(Math.min(stage.clientWidth / width, stage.clientHeight / height)));
  canvas.style.width = `${width * scale}px`;
  canvas.style.height = `${height * scale}px`;
}

// utils/genesisControls.ts и genesisGamepad.ts работают с экшенами в верхнем
// регистре (GenesisActionName, единый стиль с NES-раскладками), а GenesisCore.setInput
// ожидает поля GenesisButtons в нижнем — переводим по этой карте.
const GENESIS_ACTION_TO_KEY: Record<GenesisActionName, keyof GenesisButtons> = {
  UP: "up",
  DOWN: "down",
  LEFT: "left",
  RIGHT: "right",
  A: "a",
  B: "b",
  C: "c",
  START: "start",
};

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
  const isGenesis = game.romPath.toLowerCase().endsWith(".gen");
  const genesisCoreRef = useRef<GenesisCore | null>(null);
  const genesisRafRef = useRef<number | undefined>(undefined);
  const genesisAudioCtxRef = useRef<AudioContext | null>(null);
  const genesisKeyHandlersRef = useRef<{ onKeyDown: (e: KeyboardEvent) => void; onKeyUp: (e: KeyboardEvent) => void } | null>(null);
  // RAF-цикл Genesis определяется один раз при загрузке ROM (см. основной эффект)
  // и переживает ре-рендеры — читает актуальную паузу через ref, а не замыкание.
  const pausedRef = useRef(false);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

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
    if (isGenesis ? !genesisCoreRef.current : !browserRef.current) return;
    try {
      const data = isGenesis
        ? genesisStateToBase64(genesisCoreRef.current!.serializeState())
        : JSON.stringify(browserRef.current!.nes.toJSON());
      await saveState(game.id, slot, data);
      setSlots(await listSaveSlots(game.id));
    } catch (err) {
      setSlotError(String(err));
    }
  }

  async function handleLoadFromSlot(slot: number) {
    if (isGenesis ? !genesisCoreRef.current : !browserRef.current) return;
    try {
      const data = await loadState(game.id, slot);
      if (isGenesis) {
        genesisCoreRef.current!.unserializeState(genesisStateFromBase64(data));
      } else {
        browserRef.current!.nes.fromJSON(JSON.parse(data));
      }
      setOverlayOpen(false);
    } catch (err) {
      setSlotError(String(err));
    }
  }

  useEffect(() => {
    let cancelled = false;

    getVolume().then((volume) => {
      if (cancelled) return;

      if (netplay && isGenesis) {
        // NetplayEngine завязан на внутренности jsnes (см. docs/netplay.md) — для
        // Genesis кооп ещё не реализован (см. docs/platforms.md), явная ошибка
        // вместо попытки скормить Genesis ROM в NES-движок.
        setErrorMessage("Кооп для Sega Genesis игр пока не поддерживается.");
        setStatus("error");
        return;
      }

      if (netplay) {
        // ROM уже прочитан в лобби (там же проверена чек-сумма с партнёром) —
        // повторно читать не нужно, к тому же движок должен грузить ровно те же
        // байты, что были захэшированы, без риска рассинхрона из-за гонки.
        if (!stageRef.current) return;
        netplayEngineRef.current = new NetplayEngine({
          container: stageRef.current,
          romData: netplay.romData,
          localPlayer: netplay.localPlayer,
          volume,
          sendInput: netplay.transport === "steam" ? steamSendInput : sendNetplayInput,
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
        fitScreenPixelPerfect(stageRef.current, NES_WIDTH, NES_HEIGHT);
        setStatus("playing");
        return;
      }

      if (isGenesis) {
        launchGame(game.id)
          .then(readRomBytes)
          .then(async (romData) => {
            if (cancelled || !stageRef.current) return;
            const core = await GenesisCore.create();
            if (cancelled) {
              core.destroy();
              return;
            }
            core.loadRom(romData);
            genesisCoreRef.current = core;

            const canvas = document.createElement("canvas");
            canvas.width = core.width;
            canvas.height = core.height;
            stageRef.current.replaceChildren(canvas);
            const ctx2d = canvas.getContext("2d");
            if (!ctx2d) throw new Error("2D canvas context недоступен");

            const audioCtx = new AudioContext();
            const gain = audioCtx.createGain();
            gain.gain.value = volume;
            gain.connect(audioCtx.destination);
            genesisAudioCtxRef.current = audioCtx;
            let nextAudioTime = audioCtx.currentTime;

            function playAudio(samples: Int16Array) {
              const frames = samples.length / 2;
              if (frames === 0) return;
              const buffer = audioCtx.createBuffer(2, frames, core.sampleRate);
              const left = buffer.getChannelData(0);
              const right = buffer.getChannelData(1);
              for (let i = 0; i < frames; i++) {
                left[i] = samples[i * 2] / 32768;
                right[i] = samples[i * 2 + 1] / 32768;
              }
              const source = audioCtx.createBufferSource();
              source.buffer = buffer;
              source.connect(gain);
              const startAt = Math.max(audioCtx.currentTime, nextAudioTime);
              source.start(startAt);
              nextAudioTime = startAt + buffer.duration;
            }

            // Раскладка клавиатуры обоих игроков — из Settings Screen → «Эмулятор» →
            // Genesis (localStorage, см. utils/genesisControls.ts). Читаем один раз при
            // монтировании, как и NES-раскладка ниже (переназначение подхватится со
            // следующего захода на экран). GenesisCore.setInput() принимает полное
            // состояние пада за раз (не buttonDown/Up по отдельности, как jsnes), поэтому
            // держим его сами, по игроку.
            const genesisCodeMap = getGenesisCodeBasedKeyMap();
            const playerButtons: [GenesisButtons, GenesisButtons] = [{}, {}];
            const onKeyDown = (e: KeyboardEvent) => {
              const mapped = genesisCodeMap[e.code];
              if (!mapped) return;
              const [player, action] = mapped;
              playerButtons[player][GENESIS_ACTION_TO_KEY[action]] = true;
              core.setInput(player, playerButtons[player]);
              e.preventDefault();
            };
            const onKeyUp = (e: KeyboardEvent) => {
              const mapped = genesisCodeMap[e.code];
              if (!mapped) return;
              const [player, action] = mapped;
              playerButtons[player][GENESIS_ACTION_TO_KEY[action]] = false;
              core.setInput(player, playerButtons[player]);
              e.preventDefault();
            };
            document.addEventListener("keydown", onKeyDown);
            document.addEventListener("keyup", onKeyUp);
            genesisKeyHandlersRef.current = { onKeyDown, onKeyUp };

            function loop() {
              if (!pausedRef.current) {
                core.frame();
                const frame = core.getFrameRgba();
                if (frame) {
                  if (canvas.width !== frame.width || canvas.height !== frame.height) {
                    canvas.width = frame.width;
                    canvas.height = frame.height;
                    if (stageRef.current) fitScreenPixelPerfect(stageRef.current, frame.width, frame.height);
                  }
                  ctx2d!.putImageData(new ImageData(new Uint8ClampedArray(frame.rgba), frame.width, frame.height), 0, 0);
                }
                playAudio(core.drainAudio());
              }
              genesisRafRef.current = requestAnimationFrame(loop);
            }
            genesisRafRef.current = requestAnimationFrame(loop);

            fitScreenPixelPerfect(stageRef.current, core.width, core.height);
            setStatus("playing");
          })
          .catch((err) => {
            if (!cancelled) {
              setErrorMessage(String(err));
              setStatus("error");
            }
          });
        return;
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

        const nesAny = browserRef.current.nes as any;
        const originalOnAudioSample = nesAny.opts.onAudioSample;
        if (originalOnAudioSample) {
          nesAny.opts.onAudioSample = (l: number, r: number) => {
            originalOnAudioSample.call(nesAny.opts, l * volume, r * volume);
          };
        }

        // Из-за того что jsnes использует устаревший e.keyCode, в русской раскладке (IME)
        // он возвращает 229 для всех клавиш, что приводит к ложным срабатываниям ("выстрел" от любой кнопки).
        // Поэтому мы отключаем стандартные обработчики jsnes и слушаем e.code напрямую.
        const keyboard = browserRef.current.keyboard;
        document.removeEventListener("keydown", keyboard.handleKeyDown);
        document.removeEventListener("keyup", keyboard.handleKeyUp);
        document.removeEventListener("keypress", keyboard.handleKeyPress);

        const codeMap = getCodeBasedKeyMap();

        const onKeyDown = (e: KeyboardEvent) => {
          const mapped = codeMap[e.code];
          if (mapped) {
            browserRef.current?.nes.buttonDown(mapped[0], mapped[1]);
            e.preventDefault();
          }
        };

        const onKeyUp = (e: KeyboardEvent) => {
          const mapped = codeMap[e.code];
          if (mapped) {
            browserRef.current?.nes.buttonUp(mapped[0], mapped[1]);
            e.preventDefault();
          }
        };

        document.addEventListener("keydown", onKeyDown);
        document.addEventListener("keyup", onKeyUp);

        // Сохраняем оригинальный destroy, чтобы также отписаться от наших событий
        const originalDestroy = browserRef.current.destroy.bind(browserRef.current);
        browserRef.current.destroy = () => {
          document.removeEventListener("keydown", onKeyDown);
          document.removeEventListener("keyup", onKeyUp);
          originalDestroy();
        };

        fitScreenPixelPerfect(stageRef.current, NES_WIDTH, NES_HEIGHT);
        setStatus("playing");
      })
      .catch((err) => {
        if (!cancelled) {
          setErrorMessage(String(err));
          setStatus("error");
        }
      });
    });

    return () => {
      cancelled = true;
      browserRef.current?.destroy();
      browserRef.current = null;
      if (genesisRafRef.current !== undefined) {
        cancelAnimationFrame(genesisRafRef.current);
        genesisRafRef.current = undefined;
      }
      if (genesisKeyHandlersRef.current) {
        document.removeEventListener("keydown", genesisKeyHandlersRef.current.onKeyDown);
        document.removeEventListener("keyup", genesisKeyHandlersRef.current.onKeyUp);
        genesisKeyHandlersRef.current = null;
      }
      if (genesisCoreRef.current) {
        genesisCoreRef.current.destroy();
        genesisCoreRef.current = null;
      }
      if (genesisAudioCtxRef.current) {
        genesisAudioCtxRef.current.close().catch(() => {});
        genesisAudioCtxRef.current = null;
      }
      // Гейтим на реально созданный движок, а не просто на наличии netplay-сессии:
      // getVolume() асинхронный, и в dev под React.StrictMode эффект сначала
      // монтируется и тут же размонтируется "призрачно" — к этому моменту
      // движок ещё не создан. Без этой проверки disconnectNetplay() стирал бы
      // только что установленную Rust-сессию до того, как её вообще начали
      // использовать, и повторный (уже настоящий) монтаж навсегда терял кооп.
      if (netplayEngineRef.current) {
        netplayEngineRef.current.destroy();
        netplayEngineRef.current = null;
        (netplay?.transport === "steam" ? steamDisconnect() : disconnectNetplay()).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id, netplay]);

  useEffect(() => {
    if (status !== "playing" || !stageRef.current) return;
    const stage = stageRef.current;
    function handleResize() {
      if (isGenesis && genesisCoreRef.current) {
        fitScreenPixelPerfect(stage, genesisCoreRef.current.width, genesisCoreRef.current.height);
      } else {
        fitScreenPixelPerfect(stage, NES_WIDTH, NES_HEIGHT);
      }
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [status, isGenesis]);

  // jsnes не конфигурирует геймпад сам (ждёт мастер настройки нажатием кнопок), а его
  // встроенный GamepadController привязывает раскладку по строковому id устройства —
  // это не различает двух игроков с одинаковой моделью контроллера (у обеих один и тот
  // же id). Поэтому опрашиваем геймпады сами и применяем сохранённую раскладку
  // (см. src/utils/jsnesGamepad.ts) напрямую через nes.buttonDown/buttonUp, назначая
  // игроков по порядку подключения — первый геймпад Игроку 1, второй Игроку 2.
  useEffect(() => {
    if (status !== "playing" || netplay || isGenesis) return; // Genesis — отдельный опрос ниже, кооп читает ввод сам (LocalInputReader)
    const maps = getGamepadButtonMaps();
    const prevPressed: boolean[][] = [[], []];
    // Индексируется по позиции биндинга в maps[i].axes (не по axisId — на один
    // и тот же физический axisId может быть назначено 2 разных действия, напр.
    // LEFT/RIGHT на axisId 0 с разным направлением).
    const prevAxisPressed: boolean[][] = [[], []];
    let rafId: number;

    function poll() {
      const pads = Array.from(navigator.getGamepads()).filter((p): p is Gamepad => p !== null);
      const nes = browserRef.current?.nes;
      for (let i = 0; i < 2; i++) {
        const pad = pads[i];
        if (!pad || !nes) {
          prevPressed[i] = [];
          prevAxisPressed[i] = [];
          continue;
        }
        for (const [buttonIndex, nesButton] of maps[i].buttons) {
          const pressed = pad.buttons[buttonIndex]?.pressed ?? false;
          const wasPressed = prevPressed[i][buttonIndex] ?? false;
          if (pressed && !wasPressed) nes.buttonDown((i + 1) as 1 | 2, nesButton);
          else if (!pressed && wasPressed) nes.buttonUp((i + 1) as 1 | 2, nesButton);
        }
        prevPressed[i] = pad.buttons.map((b) => b.pressed);

        maps[i].axes.forEach((axisBinding, slot) => {
          const pressed = isAxisPressed(pad.axes[axisBinding.axisId] ?? 0, axisBinding.direction);
          const wasPressed = prevAxisPressed[i][slot] ?? false;
          if (pressed && !wasPressed) nes.buttonDown((i + 1) as 1 | 2, axisBinding.nesButton);
          else if (!pressed && wasPressed) nes.buttonUp((i + 1) as 1 | 2, axisBinding.nesButton);
          prevAxisPressed[i][slot] = pressed;
        });
      }
      rafId = requestAnimationFrame(poll);
    }
    rafId = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(rafId);
  }, [status, netplay]);

  // Геймпад для Genesis (3-кнопочный пад): раскладка из Settings Screen → «Эмулятор» →
  // Genesis (localStorage, см. utils/genesisGamepad.ts), по умолчанию D-pad → стрелки,
  // кнопки 0/1/2 → B/A/C, кнопка 9 → Start. Полное состояние (не down/up-события), как и
  // клавиатура в основном эффекте выше — GenesisCore.setInput() каждый раз принимает
  // весь пад целиком.
  useEffect(() => {
    if (status !== "playing" || netplay || !isGenesis) return;
    const maps = getGenesisGamepadButtonMaps();
    let rafId: number;
    function poll() {
      const core = genesisCoreRef.current;
      if (core) {
        const pads = Array.from(navigator.getGamepads()).filter((p): p is Gamepad => p !== null);
        for (let i = 0; i < 2; i++) {
          const pad = pads[i];
          if (!pad) continue;
          const buttons: GenesisButtons = {};
          for (const [buttonIndex, action] of maps[i].buttons) {
            if (pad.buttons[buttonIndex]?.pressed) buttons[GENESIS_ACTION_TO_KEY[action]] = true;
          }
          for (const axisBinding of maps[i].axes) {
            if (isAxisPressed(pad.axes[axisBinding.axisId] ?? 0, axisBinding.direction)) {
              buttons[GENESIS_ACTION_TO_KEY[axisBinding.action]] = true;
            }
          }
          core.setInput(i as 0 | 1, buttons);
        }
      }
      rafId = requestAnimationFrame(poll);
    }
    rafId = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(rafId);
  }, [status, netplay, isGenesis]);

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
    if (isGenesis) {
      if (!genesisCoreRef.current) return;
      // RAF-цикл Genesis сам проверяет pausedRef каждый тик (см. основной эффект) —
      // здесь достаточно переключить state, ref синхронизируется отдельным эффектом.
      setPaused(!paused);
      return;
    }
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
