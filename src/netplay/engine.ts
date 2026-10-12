// Кооп-движок: гоняет NES (jsnes) или Genesis (GenesisCore) напрямую (без
// jsnes Browser — см. docs/netplay.md, у Browser нет хука для внедрения
// синхронизированного ввода партнёра перед кадром) по лок-степ протоколу с
// задержкой ввода: расхождение исключено в принципе — кадр эмулируется только
// когда известен ввод обоих игроков за него, иначе локально просто ждём.
// Когда и сколько кадров прогонять, что и когда слать партнёру — решает
// платформо-агностичный Lockstep (./lockstep.ts), звук с джиттер-буфером —
// NetplayAudio (./audio.ts); здесь только то, что зависит от платформы:
// инициализация ядра, применение ввода к кадру и вывод картинки (stepNes/
// stepGenesis, presentNes/presentGenesis) — то же ветвление isGenesis, что уже
// есть в EmulatorScreen для одиночной игры, а не общий интерфейс движка (см.
// docs/platforms.md#netplay-кооп: два явных случая проще, чем абстракция
// ради двух потребителей).
import { NES } from "jsnes";
import Screen from "jsnes/src/browser/screen.js";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { onPeerDisconnected, onRemoteInput } from "../api/netplay";
import { applyButtons, LocalInputReader } from "./localInput";
import { decodeGenesisButtons, LocalGenesisInputReader } from "./genesisLocalInput";
import { GenesisCore } from "../emulator/genesis/GenesisCore";
import { Lockstep, type InputPacket } from "./lockstep";
import { NetplayAudio } from "./audio";

const NES_WIDTH = 256;
const NES_HEIGHT = 240;
// Нативная частота кадров NTSC NES — та же, что у jsnes FrameTimer в одиночной игре.
const NES_FPS = 60.0988;
// Реальные размеры кадра Genesis известны только после GenesisCore.create()+
// loadRom() (асинхронно, WASM) — эти дефолты используются только как
// провизорный размер до этого момента (см. width/height ниже, EmulatorScreen
// их не читает, пока не сработает onReady).
const GENESIS_DEFAULT_WIDTH = 320;
const GENESIS_DEFAULT_HEIGHT = 224;

export interface NetplayEngineOptions {
  container: HTMLElement;
  romData: Uint8Array;
  localPlayer: 1 | 2;
  platform: "nes" | "genesis";
  volume?: number;
  // Отправка пакета ввода партнёру — единственное, что реально зависит от
  // транспорта (LAN/Steam, см. docs/netplay.md); движок сам транспорт не
  // знает, вызывающий код (EmulatorScreen) передаёт нужную функцию.
  sendInput: (packet: InputPacket) => void;
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

  private genesisCore?: GenesisCore;
  private genesisCanvas?: HTMLCanvasElement;
  private genesisCtx?: CanvasRenderingContext2D;
  private genesisImage?: ImageData;

  private audio?: NetplayAudio;
  private lockstep?: Lockstep;

  private readonly input: LocalInputReader | LocalGenesisInputReader;
  private readonly localPlayer: 1 | 2;
  private readonly remotePlayer: 1 | 2;
  private readonly sendInputFn: (packet: InputPacket) => void;
  private readonly onErrorCb?: (error: unknown) => void;
  private readonly onPeerDisconnectedCb?: () => void;

  /** Текущий размер кадра — фиксированный для NES, обновляется для Genesis
   *  после загрузки ROM (см. initGenesis). Читает EmulatorScreen для подгонки
   *  канвы (fitScreenPixelPerfect) в onReady и по window resize. */
  width: number;
  height: number;

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

    // AudioContext создаётся синхронно в конструкторе NetplayAudio, так что его
    // реальная частота известна до создания NES — jsnes генерирует звук сразу
    // в ней (громкость — через GainNode внутри NetplayAudio).
    this.audio = new NetplayAudio({ volume: options.volume ?? 1.0 });
    this.screen = new Screen(options.container);
    this.nes = new NES({
      onFrame: this.screen.setBuffer,
      onAudioSample: this.audio.writeSample,
      sampleRate: this.audio.sampleRate,
    });

    try {
      this.nes.loadROM(options.romData);
    } catch (err) {
      this.onErrorCb?.(err);
      this.destroy();
      return;
    }

    this.screen.fitInParent();

    this.startNetworking(NES_FPS);
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

      this.audio = new NetplayAudio({ volume: options.volume ?? 1.0, inputSampleRate: core.sampleRate });
    } catch (err) {
      this.onErrorCb?.(err);
      this.destroy();
      return;
    }

    this.startNetworking(this.genesisCore!.fps);
    options.onReady?.({ width: this.width, height: this.height });
  }

  /** Общая для NES/Genesis часть: подписка на события партнёра и старт rAF-цикла. */
  private startNetworking(fps: number): void {
    this.lockstep = new Lockstep({ fps, send: this.sendInputFn });

    // Пакеты партнёра, пришедшие до того, как подписка успела зарегистрироваться,
    // не теряются насовсем: он переотправляет всё неподтверждённое (см. lockstep.ts).
    void onRemoteInput((packet) => this.lockstep?.receive(packet, performance.now())).then((unlisten) => {
      if (this.destroyed) unlisten();
      else this.unlistenInput = unlisten;
    });
    void onPeerDisconnected(() => this.onPeerDisconnectedCb?.()).then((unlisten) => {
      if (this.destroyed) unlisten();
      else this.unlistenDisconnect = unlisten;
    });

    this.rafId = requestAnimationFrame(this.tick);
  }

  private tick = (time: number): void => {
    if (this.destroyed) return;
    this.rafId = requestAnimationFrame(this.tick);

    try {
      const { stepped, timedOut } = this.lockstep!.tick(
        time,
        this.readInput,
        this.isGenesis ? this.stepGenesis : this.stepNes,
      );
      if (timedOut) {
        // Без этого таймаута локальный рендер при пропавшем партнёре просто
        // замирал бы намертво и молча — неотличимо от чёрного экрана/краша.
        this.onErrorCb?.(new Error("Партнёр не отвечает — нет данных от сети. Проверьте соединение."));
        this.destroy();
        return;
      }
      // Картинку и звук отдаём раз за тик, даже если прогнано несколько кадров
      // (догоняем после стойки) — показывать промежуточные кадры всё равно некогда.
      if (stepped > 0) {
        if (this.isGenesis) this.presentGenesis();
        else this.presentNes();
      }
    } catch (err) {
      this.onErrorCb?.(err);
      this.destroy();
    }
  };

  private readInput = (): number => this.input.read();

  private stepNes = (localBits: number, remoteBits: number): void => {
    const nes = this.nes!;
    applyButtons(nes, this.localPlayer, localBits);
    applyButtons(nes, this.remotePlayer, remoteBits);
    nes.frame();
  };

  private presentNes(): void {
    this.screen!.writeBuffer();
    this.audio!.flush();
  }

  private stepGenesis = (localBits: number, remoteBits: number): void => {
    const core = this.genesisCore!;
    core.setInput((this.localPlayer - 1) as 0 | 1, decodeGenesisButtons(localBits));
    core.setInput((this.remotePlayer - 1) as 0 | 1, decodeGenesisButtons(remoteBits));
    core.frame();
  };

  private presentGenesis(): void {
    const core = this.genesisCore!;
    const size = core.frameSize();
    if (size) {
      // ImageData переиспользуется между кадрами — без пары аллокаций по
      // ~280КБ на каждый кадр, из-за которых сборщик мусора давал паузы.
      if (!this.genesisImage || this.genesisImage.width !== size.width || this.genesisImage.height !== size.height) {
        this.genesisImage = new ImageData(size.width, size.height);
        this.genesisCanvas!.width = size.width;
        this.genesisCanvas!.height = size.height;
        this.width = size.width;
        this.height = size.height;
      }
      core.writeFrameRgba(this.genesisImage.data);
      this.genesisCtx!.putImageData(this.genesisImage, 0, 0);
    }
    this.audio!.writeS16(core.drainAudio());
    this.audio!.flush();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.rafId);
    this.input.destroy();
    this.unlistenInput?.();
    this.unlistenDisconnect?.();
    this.audio?.destroy();
    if (this.isGenesis) {
      this.genesisCore?.destroy();
    } else {
      this.screen?.destroy();
    }
  }
}
