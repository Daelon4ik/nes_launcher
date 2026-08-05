// jsnes не поставляет собственные типы и в npm нет @types/jsnes — минимальная
// декларация под то, что реально используем (см. EmulatorScreen).
declare module "jsnes" {
  export interface BrowserOptions {
    container: HTMLElement;
    romData?: Uint8Array;
    onError?: (error: unknown) => void;
    onBatteryRamWrite?: (address: number, value: number) => void;
  }

  export class Browser {
    constructor(options: BrowserOptions);
    gamepad: {
      setGamepadConfig: (config: unknown) => void;
    };
    keyboard: {
      keys: Record<number, [number, number, string]>;
      setKeys: (keys: Record<number, [number, number, string]>) => void;
      onButtonDown: (player: number, button: number) => void;
      onButtonUp: (player: number, button: number) => void;
    };
    start(): void;
    stop(): void;
    loadROM(data: Uint8Array): void;
    fitInParent(): void;
    destroy(): void;
  }

  export class Controller {
    static BUTTON_A: number;
    static BUTTON_B: number;
    static BUTTON_SELECT: number;
    static BUTTON_START: number;
    static BUTTON_UP: number;
    static BUTTON_DOWN: number;
    static BUTTON_LEFT: number;
    static BUTTON_RIGHT: number;
  }

  // Используется напрямую (без Browser) в кооп-режиме — см. src/netplay/engine.ts.
  export interface NESOptions {
    onFrame?: (buffer: Uint32Array) => void;
    onAudioSample?: (left: number, right: number) => void;
    onStatusUpdate?: (status: string) => void;
    onBatteryRamWrite?: (address: number, value: number) => void;
    sampleRate?: number;
  }

  export class NES {
    constructor(opts: NESOptions);
    frame: () => void;
    buttonDown: (controller: 1 | 2, button: number) => void;
    buttonUp: (controller: 1 | 2, button: number) => void;
    loadROM: (data: Uint8Array) => void;
  }
}

// Внутренние классы Browser (не экспортируются из "jsnes" — см. index.js), но
// нужны напрямую для кооп-движка (Browser нельзя переиспользовать: у него нет
// хука для внедрения синхронизированного инпута перед кадром — см. docs/netplay.md).
declare module "jsnes/src/browser/screen.js" {
  export default class Screen {
    constructor(
      container: HTMLElement,
      options?: { onMouseDown?: (x: number, y: number) => void; onMouseUp?: () => void },
    );
    canvas: HTMLCanvasElement;
    setBuffer: (buffer: Uint32Array) => void;
    writeBuffer: () => void;
    fitInParent: () => void;
    destroy: () => void;
  }
}

declare module "jsnes/src/browser/speakers.js" {
  export default class Speakers {
    constructor(options: { onBufferUnderrun?: () => void });
    getSampleRate: () => number;
    start: () => Promise<void>;
    stop: () => void;
    writeSample: (left: number, right: number) => void;
    flush: () => void;
  }
}
