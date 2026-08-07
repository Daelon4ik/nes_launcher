// Кооп-движок: гоняет jsnes напрямую (без Browser — см. docs/netplay.md,
// у Browser нет хука для внедрения синхронизированного ввода партнёра перед
// кадром) по лок-степ протоколу с фиксированной задержкой ввода: расхождение
// исключено в принципе — оба пира продвигаются только когда оба знают ввод
// друг друга за конкретный номер кадра, иначе локально просто ждём (стойка).
import { NES } from "jsnes";
import Screen from "jsnes/src/browser/screen.js";
import Speakers from "jsnes/src/browser/speakers.js";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { onPeerDisconnected, onRemoteInput, sendInput } from "../api/netplay";
import { applyButtons, LocalInputReader } from "./localInput";

// ~100мс на 60кадр/с — с запасом перекрывает LAN RTT (обычно <5мс) и Tauri IPC
// (тот же процесс, доли мс). Не настраивается пользователем — см. docs/netplay.md.
const INPUT_DELAY_FRAMES = 6;

export interface NetplayEngineOptions {
  container: HTMLElement;
  romData: Uint8Array;
  localPlayer: 1 | 2;
  volume?: number;
  onError?: (error: unknown) => void;
  onPeerDisconnected?: () => void;
}

export class NetplayEngine {
  private nes: NES;
  private screen: Screen;
  private speakers: Speakers;
  private input: LocalInputReader;
  private readonly localPlayer: 1 | 2;
  private readonly remotePlayer: 1 | 2;
  private readonly onErrorCb?: (error: unknown) => void;
  private readonly onPeerDisconnectedCb?: () => void;

  private frameNo = 0;
  private readonly localHistory = new Map<number, number>();
  private readonly remoteHistory = new Map<number, number>();
  private rafId = 0;
  private destroyed = false;
  private unlistenInput: UnlistenFn | null = null;
  private unlistenDisconnect: UnlistenFn | null = null;

  constructor(options: NetplayEngineOptions) {
    this.localPlayer = options.localPlayer;
    this.remotePlayer = options.localPlayer === 1 ? 2 : 1;
    this.onErrorCb = options.onError;
    this.onPeerDisconnectedCb = options.onPeerDisconnected;

    this.speakers = new Speakers({ onBufferUnderrun: () => {} });
    
    const volume = options.volume ?? 1.0;
    const originalWriteSample = this.speakers.writeSample.bind(this.speakers);
    this.speakers.writeSample = (l: number, r: number) => {
      originalWriteSample(l * volume, r * volume);
    };

    this.screen = new Screen(options.container);
    this.input = new LocalInputReader();
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
      sendInput(sendFrame, localBits);

      const remoteBits = this.remoteHistory.get(this.frameNo);
      if (remoteBits === undefined) {
        // Ввод партнёра для текущего кадра ещё не пришёл — не продвигаемся.
        // Это и есть гарантия отсутствия рассинхрона: кадр не рендерится, пока
        // обе стороны не знают точное состояние обоих контроллеров для него.
        this.rafId = requestAnimationFrame(this.tick);
        return;
      }

      const localBitsForFrame = this.localHistory.get(this.frameNo) ?? 0;
      applyButtons(this.nes, this.localPlayer, localBitsForFrame);
      applyButtons(this.nes, this.remotePlayer, remoteBits);

      this.nes.frame();
      this.screen.writeBuffer();
      this.speakers.flush();

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

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.rafId);
    this.input.destroy();
    this.speakers.stop();
    this.screen.destroy();
    this.unlistenInput?.();
    this.unlistenDisconnect?.();
  }
}
