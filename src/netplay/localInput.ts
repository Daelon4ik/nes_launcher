// Захват локального ввода (клавиатура + геймпад) для кооп-движка
// (src/netplay/engine.ts). Независим от jsnes-контроллеров — Browser нельзя
// переиспользовать для netplay (см. docs/netplay.md), поэтому читаем ввод сами
// и явно применяем к нужному игроку через NES.buttonDown/buttonUp.
import { Controller, type NES } from "jsnes";

// Совпадает с дефолтной раскладкой jsnes для игрока 1
// (node_modules/jsnes/src/browser/keyboard.js) — единая раскладка независимо
// от роли (хост/клиент), меняется только то, какому NES-контроллеру уходит ввод.
const KEY_TO_BUTTON: Record<string, number> = {
  ArrowUp: Controller.BUTTON_UP,
  ArrowDown: Controller.BUTTON_DOWN,
  ArrowLeft: Controller.BUTTON_LEFT,
  ArrowRight: Controller.BUTTON_RIGHT,
  KeyW: Controller.BUTTON_UP,
  KeyS: Controller.BUTTON_DOWN,
  KeyA: Controller.BUTTON_LEFT,
  KeyD: Controller.BUTTON_RIGHT,
  KeyX: Controller.BUTTON_A,
  KeyE: Controller.BUTTON_A,
  KeyZ: Controller.BUTTON_B,
  KeyQ: Controller.BUTTON_B,
  Enter: Controller.BUTTON_START,
  Space: Controller.BUTTON_START,
  ControlRight: Controller.BUTTON_SELECT,
  ShiftLeft: Controller.BUTTON_SELECT,
  ShiftRight: Controller.BUTTON_SELECT,
};

// Совпадает с src/utils/jsnesGamepad.ts (стандартная раскладка Gamepad API).
const GAMEPAD_BUTTON_TO_NES: Record<number, number> = {
  0: Controller.BUTTON_A,
  1: Controller.BUTTON_B,
  8: Controller.BUTTON_SELECT,
  9: Controller.BUTTON_START,
  12: Controller.BUTTON_UP,
  13: Controller.BUTTON_DOWN,
  14: Controller.BUTTON_LEFT,
  15: Controller.BUTTON_RIGHT,
};

const AXIS_THRESHOLD = 0.5;

/// Читает текущее состояние NES-кнопок (клавиатура + первый геймпад) в виде
/// битовой маски: bit N установлен = кнопка Controller.BUTTON_* с id=N зажата.
/// Turbo-кнопки (8/9) намеренно не читаются — не нужны для сетевой синхронизации.
export class LocalInputReader {
  private held = new Set<string>();

  constructor() {
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.code in KEY_TO_BUTTON) this.held.add(e.code);
  };

  private handleKeyUp = (e: KeyboardEvent) => {
    this.held.delete(e.code);
  };

  read(): number {
    let bits = 0;
    for (const code of this.held) {
      bits |= 1 << KEY_TO_BUTTON[code];
    }

    // В netplay берём любой доступный геймпад для локального ввода
    const pads = navigator.getGamepads?.() || [];
    const pad = pads[0] || pads[1];
    if (pad) {
      for (const [index, button] of Object.entries(GAMEPAD_BUTTON_TO_NES)) {
        if (pad.buttons[Number(index)]?.pressed) bits |= 1 << button;
      }
      const [x = 0, y = 0] = pad.axes;
      if (y < -AXIS_THRESHOLD) bits |= 1 << Controller.BUTTON_UP;
      else if (y > AXIS_THRESHOLD) bits |= 1 << Controller.BUTTON_DOWN;
      if (x < -AXIS_THRESHOLD) bits |= 1 << Controller.BUTTON_LEFT;
      else if (x > AXIS_THRESHOLD) bits |= 1 << Controller.BUTTON_RIGHT;
    }

    return bits;
  }

  destroy() {
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
  }
}

/// Применяет битовую маску ко всем 8 кнопкам указанного NES-контроллера.
/// buttonDown/buttonUp у jsnes идемпотентны, так что дифф с предыдущим
/// состоянием не нужен — просто выставляем всё состояние заново каждый кадр.
export function applyButtons(nes: NES, controller: 1 | 2, bits: number): void {
  for (let button = 0; button <= 7; button++) {
    if (bits & (1 << button)) {
      nes.buttonDown(controller, button);
    } else {
      nes.buttonUp(controller, button);
    }
  }
}
