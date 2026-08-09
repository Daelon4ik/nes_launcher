// Кооп-движок: гоняет NES (jsnes) или Genesis (GenesisCore) напрямую (без
// jsnes Browser — см. docs/netplay.md, у Browser нет хука для внедрения
// синхронизированного ввода партнёра перед кадром) по лок-степ протоколу с
// фиксированной задержкой ввода: расхождение исключено в принципе — оба пира
// продвигаются только когда оба знают ввод друг друга за конкретный номер
// кадра, иначе локально просто ждём (стойка). Буферизация/тайм-аут стойки —
// платформо-агностичны (см. tick() ниже); платформенно-зависима только
// инициализация движка и то, как конкретный кадр применяется/рендерится
// (tickNes/tickGenesis) — то же ветвление isGenesis, что уже есть в
// EmulatorScreen для одиночной игры, а не общий интерфейс движка (см.
// docs/platforms.md#netplay-кооп: два явных случая проще, чем абстракция
// ради двух потребителей).
import { NES } from "jsnes";
import Screen from "jsnes/src/browser/screen.js";
import Speakers from "jsnes/src/browser/speakers.js";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { onPeerDisconnected, onRemoteInput } from "../api/netplay";
import { applyButtons, LocalInputReader } from "./localInput";
import { decodeGenesisButtons, LocalGenesisInputReader } from "./genesisLocalInput";
import { GenesisCore } from "../emulator/genesis/GenesisCore";

const NES_WIDTH = 256;
const NES_HEIGHT = 240;
// Реальные размеры кадра Genesis известны только после GenesisCore.create()+
// loadRom() (асинхронно, WASM) — эти дефолты используются только как
// провизорный размер до этого момента (см. width/height ниже, EmulatorScreen
// их не читает, пока не сработает onReady).
const GENESIS_DEFAULT_WIDTH = 320;
const GENESIS_DEFAULT_HEIGHT = 224;

// ~100мс на 60кадр/с — с запасом перекрывает LAN RTT (обычно <5мс) и Tauri IPC
// (тот же процесс, доли мс). Не настраивается пользователем — см. docs/netplay.md.
const INPUT_DELAY_FRAMES = 6;

// Сколько подряд тиков можно простоять без хода партнёра, прежде чем считать
// сессию зависшей и явно сообщить об этом — без этого таймаута локальный рендер
// просто замирает намертво и молча (лок-степ по конструкции не продвигается без
// ввода партнёра, см. tick() ниже), что для пользователя неотличимо от чёрного
// экрана/краша. 300 тиков ~5с при 60к/с — с большим запасом над LAN/Steam Relay
// RTT в здоровой сети, но конечно, чтобы разрыв не проходил незамеченным.
const STALL_TIMEOUT_TICKS = 300;

export interface NetplayEngineOptions {
  container: HTMLElement;
  romData: Uint8Array;
  localPlayer: 1 | 2;
  platform: "nes" | "genesis";
  volume?: number;
  // Отправка кадра ввода партнёру — единственное, что реально зависит от
  // транспорта (LAN/Steam, см. docs/netplay.md); движок сам транспорт не
  // знает, вызывающий код (EmulatorScreen) передаёт нужную функцию.
  sendInput: (frame: number, buttons: number) => void;
  onError?: (error: unknown) => void;
  onPeerDisconnected?: () => void;
  // Инициализация NES синхронна, но Genesis (WASM-ядро) — нет, поэтому момент
  // "движок готов и можно подогнать размер канвы" отличается по платформе;
  // этот колбэк унифицирует его для EmulatorScreen (см. вызовы в конце
  // конструктора/initGenesis ниже). Для NES он срабатывает синхронно ВНУТРИ
  // конструктора — т.е. раньше, чем `netplayEngineRef.current = new
  // NetplayEngine(...)` успевает присвоиться на стороне вызывающего кода,
  // поэтому размер передаётся аргументом, а не через ref на сам движок.
  onReady?: (dims: { width: number; height: number }) => void;
}

export class NetplayEngine {
  private readonly isGenesis: boolean;

  private nes?: NES;
  private screen?: Screen;
  private speakers?: Speakers;

  private genesisCore?: GenesisCore;
  private genesisCanvas?: HTMLCanvasElement;
  private genesisCtx?: CanvasRenderingContext2D;
  private genesisAudioCtx?: AudioContext;
  private genesisGain?: GainNode;
  private genesisNextAudioTime = 0;

  private readonly input: LocalInputReader | LocalGenesisInputReader;
  private readonly localPlayer: 1 | 2;
  private readonly remotePlayer: 1 | 2;
  private readonly sendInputFn: (frame: number, buttons: number) => void;
  private readonly onErrorCb?: (error: unknown) => void;
  private readonly onPeerDisconnectedCb?: () => void;

  /** Текущий размер кадра — фиксированный для NES, обновляется для Genesis
   *  после загрузки ROM (см. initGenesis). Читает EmulatorScreen для подгонки
   *  канвы (fitScreenPixelPerfect) в onReady и по window resize. */
  width: number;
  height: number;

  private frameNo = 0;
  private stalledTicks = 0;
  private readonly localHistory = new Map<number, number>();
  private readonly remoteHistory = new Map<number, number>();
  private rafId = 0;
  private destroyed = false;
  private unlistenInput: UnlistenFn | null = null;
  private unlistenDisconnect: UnlistenFn | null = null;

  constructor(options: NetplayEngineOptions) {
    this.localPlayer = options.localPlayer;
    this.remotePlayer = options.localPlayer === 1 ? 2 : 1;
    this.sendInputFn = options.sendInput;
    this.onErrorCb = options.onError;
    this.onPeerDisconnectedCb = options.onPeerDisconnected;
    this.isGenesis = options.platform === "genesis";

    if (this.isGenesis) {
      this.width = GENESIS_DEFAULT_WIDTH;
      this.height = GENESIS_DEFAULT_HEIGHT;
      this.input = new LocalGenesisInputReader();
      void this.initGenesis(options);
      return;
    }

    this.width = NES_WIDTH;
    this.height = NES_HEIGHT;
    this.input = new LocalInputReader();

    this.speakers = new Speakers({ onBufferUnderrun: () => {} });

    const volume = options.volume ?? 1.0;
    const originalWriteSample = this.speakers.writeSample.bind(this.speakers);
    this.speakers.writeSample = (l: number, r: number) => {
      originalWriteSample(l * volume, r * volume);
    };

    this.screen = new Screen(options.container);
    this.nes = new NES({
      onFrame: this.screen.setBuffer,
      onAudioSample: this.speakers.writeSample,
      sampleRate: this.speakers.getSampleRate(),
    });

    try {
      this.nes.loadROM(options.romData);
    } catch (err) {
      this.onErrorCb?.(err);
      this.destroy();
      return;
    }

    void this.speakers.start();
    this.screen.fitInParent();

    this.startNetworking();
    options.onReady?.({ width: this.width, height: this.height });
  }

  /** Асинхронный аналог синхронной NES-ветки конструктора — GenesisCore.create()
   *  грузит WASM-ядро, поэтому канва/аудио/сетевой цикл стартуют только после
   *  этого, в отличие от NES (см. также EmulatorScreen — тот же порядок шагов
   *  для одиночной игры). */
  private async initGenesis(options: NetplayEngineOptions): Promise<void> {
    try {
      const core = await GenesisCore.create();
      if (this.destroyed) {
        core.destroy();
        return;
      }
      core.loadRom(options.romData);
      this.genesisCore = core;
      this.width = core.width;
      this.height = core.height;

      const canvas = document.createElement("canvas");
      canvas.width = core.width;
      canvas.height = core.height;
      options.container.replaceChildren(canvas);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("2D canvas context недоступен");
      this.genesisCanvas = canvas;
      this.genesisCtx = ctx;

      const audioCtx = new AudioContext();
      const gain = audioCtx.createGain();
      gain.gain.value = options.volume ?? 1.0;
      gain.connect(audioCtx.destination);
      this.genesisAudioCtx = audioCtx;
      this.genesisGain = gain;
      this.genesisNextAudioTime = audioCtx.currentTime;
    } catch (err) {
      this.onErrorCb?.(err);
      this.destroy();
      return;
    }

    this.startNetworking();
    options.onReady?.({ width: this.width, height: this.height });
  }

  /** Общая для NES/Genesis часть: предзаполнение первых кадров (см. комментарий
   *  внутри), подписка на события партнёра и старт rAF-цикла. */
  private startNetworking(): void {
    // Кадры 0..INPUT_DELAY_FRAMES-1 не покрыты обычной отправкой (та начинается
    // только с sendFrame = frameNo + INPUT_DELAY_FRAMES, т.е. с кадра
    // INPUT_DELAY_FRAMES) — без этого лок-степ ждал бы ввод для них вечно,
    // так и не сдвинувшись с frameNo=0. Обе стороны детерминированно
    // договариваются считать эти самые первые кадры "без нажатий".
    for (let frame = 0; frame < INPUT_DELAY_FRAMES; frame++) {
      this.localHistory.set(frame, 0);
      this.remoteHistory.set(frame, 0);
    }

    void onRemoteInput((frame, buttons) => this.remoteHistory.set(frame, buttons)).then((unlisten) => {
      if (this.destroyed) unlisten();
      else this.unlistenInput = unlisten;
    });
    void onPeerDisconnected(() => this.onPeerDisconnectedCb?.()).then((unlisten) => {
      if (this.destroyed) unlisten();
      else this.unlistenDisconnect = unlisten;
    });

    this.rafId = requestAnimationFrame(this.tick);
  }

  private tick = (): void => {
    if (this.destroyed) return;

    try {
      // Шлём свой ввод с опережением на INPUT_DELAY_FRAMES — к моменту, когда
      // локальная эмуляция дойдёт до этого номера кадра, у партнёра уже будет
      // время его получить и прислать свой встречный ввод для того же кадра.
      const sendFrame = this.frameNo + INPUT_DELAY_FRAMES;
      const localBits = this.input.read();
      this.localHistory.set(sendFrame, localBits);
      this.sendInputFn(sendFrame, localBits);

      const remoteBits = this.remoteHistory.get(this.frameNo);
      if (remoteBits === undefined) {
        // Ввод партнёра для текущего кадра ещё не пришёл — не продвигаемся.
        // Это и есть гарантия отсутствия рассинхрона: кадр не рендерится, пока
        // обе стороны не знают точное состояние обоих контроллеров для него.
        this.stalledTicks++;
        if (this.stalledTicks >= STALL_TIMEOUT_TICKS) {
          this.onErrorCb?.(new Error("Партнёр не отвечает — нет данных от сети. Проверьте соединение."));
          this.destroy();
          return;
        }
        this.rafId = requestAnimationFrame(this.tick);
        return;
      }
      this.stalledTicks = 0;

      const localBitsForFrame = this.localHistory.get(this.frameNo) ?? 0;
      if (this.isGenesis) {
        this.tickGenesis(localBitsForFrame, remoteBits);
      } else {
        this.tickNes(localBitsForFrame, remoteBits);
      }

      this.localHistory.delete(this.frameNo);
      this.remoteHistory.delete(this.frameNo);
      this.frameNo++;
    } catch (err) {
      this.onErrorCb?.(err);
      this.destroy();
      return;
    }

    this.rafId = requestAnimationFrame(this.tick);
  };

  private tickNes(localBits: number, remoteBits: number): void {
    const nes = this.nes!;
    applyButtons(nes, this.localPlayer, localBits);
    applyButtons(nes, this.remotePlayer, remoteBits);
    nes.frame();
    this.screen!.writeBuffer();
    this.speakers!.flush();
  }

  private tickGenesis(localBits: number, remoteBits: number): void {
    const core = this.genesisCore!;
    const localPort = (this.localPlayer - 1) as 0 | 1;
    const remotePort = (this.remotePlayer - 1) as 0 | 1;
    core.setInput(localPort, decodeGenesisButtons(localBits));
    core.setInput(remotePort, decodeGenesisButtons(remoteBits));

    core.frame();
    const frame = core.getFrameRgba();
    if (frame) {
      const canvas = this.genesisCanvas!;
      if (canvas.width !== frame.width || canvas.height !== frame.height) {
        canvas.width = frame.width;
        canvas.height = frame.height;
        this.width = frame.width;
        this.height = frame.height;
      }
      this.genesisCtx!.putImageData(new ImageData(new Uint8ClampedArray(frame.rgba), frame.width, frame.height), 0, 0);
    }
    this.playGenesisAudio(core.drainAudio());
  }

  private playGenesisAudio(samples: Int16Array): void {
    const frames = samples.length / 2;
    if (frames === 0) return;
    const audioCtx = this.genesisAudioCtx!;
    const buffer = audioCtx.createBuffer(2, frames, this.genesisCore!.sampleRate);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    for (let i = 0; i < frames; i++) {
      left[i] = samples[i * 2] / 32768;
      right[i] = samples[i * 2 + 1] / 32768;
    }
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.genesisGain!);
    const startAt = Math.max(audioCtx.currentTime, this.genesisNextAudioTime);
    source.start(startAt);
    this.genesisNextAudioTime = startAt + buffer.duration;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.rafId);
    this.input.destroy();
    this.unlistenInput?.();
    this.unlistenDisconnect?.();
    if (this.isGenesis) {
      this.genesisCore?.destroy();
      this.genesisAudioCtx?.close().catch(() => {});
    } else {
      this.speakers?.stop();
      this.screen?.destroy();
    }
  }
}
