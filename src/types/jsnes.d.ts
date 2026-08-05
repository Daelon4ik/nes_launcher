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
}
