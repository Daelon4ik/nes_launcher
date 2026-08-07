// Захват локального ввода (клавиатура + геймпад) для кооп-движка
// (src/netplay/engine.ts). Независим от jsnes-контроллеров — Browser нельзя
// переиспользовать для netplay (см. docs/netplay.md), поэтому читаем ввод сами
// и явно применяем к нужному игроку через NES.buttonDown/buttonUp.
import { Controller, type NES } from "jsnes";
import { getNetplayKeyMap } from "../utils/keyboardControls";
import { getNetplayGamepadMap, type GamepadBindingMaps } from "../utils/jsnesGamepad";
import { AXIS_THRESHOLD, isAxisPressed } from "../utils/gamepadInput";

let KEY_TO_BUTTON: Record<string, number> = {};
let GAMEPAD_MAP: GamepadBindingMaps = { buttons: new Map(), axes: [] };

/// Читает текущее состояние NES-кнопок (клавиатура + первый геймпад) в виде
/// битовой маски: bit N установлен = кнопка Controller.BUTTON_* с id=N зажата.
/// Turbo-кнопки (8/9) намеренно не читаются — не нужны для сетевой синхронизации.
export class LocalInputReader {
  private held = new Set<string>();

  constructor() {
    KEY_TO_BUTTON = getNetplayKeyMap();
    GAMEPAD_MAP = getNetplayGamepadMap();
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
      for (const [index, button] of GAMEPAD_MAP.buttons) {
        if (pad.buttons[index]?.pressed) bits |= 1 << button;
      }
      for (const axisBinding of GAMEPAD_MAP.axes) {
        if (isAxisPressed(pad.axes[axisBinding.axisId] ?? 0, axisBinding.direction)) {
          bits |= 1 << axisBinding.nesButton;
        }
      }
      // Левый стик по умолчанию дублирует D-pad независимо от пользовательской
      // раскладки — это отдельное поведение "из коробки", а не часть ремаппинга.
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
