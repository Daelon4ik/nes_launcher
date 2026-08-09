// Захват локального ввода (клавиатура + геймпад) для кооп-движка на Genesis —
// аналог localInput.ts для NES, но со своим набором экшенов (3-кнопочный пад +
// Start, без Select, см. utils/genesisControls.ts) и собственным 8-битным
// порядком бит для протокола (Input.buttons, см. src/netplay/engine.ts) —
// не связан с внутренней раскладкой libretro RetroPad, которую использует
// GenesisCore.setInput() под капотом, важна только внутренняя согласованность
// encode/decode здесь.
import type { GenesisButtons } from "../emulator/genesis/GenesisCore";
import { getNetplayGenesisKeyMap, type GenesisActionName } from "../utils/genesisControls";
import { getNetplayGenesisGamepadMap, type GenesisGamepadBindingMaps } from "../utils/genesisGamepad";
import { AXIS_THRESHOLD, isAxisPressed } from "../utils/gamepadInput";

const BUTTON_ORDER: readonly GenesisActionName[] = ["UP", "DOWN", "LEFT", "RIGHT", "A", "B", "C", "START"];
const ACTION_TO_BIT = new Map(BUTTON_ORDER.map((action, index) => [action, index]));
const ACTION_TO_KEY: Record<GenesisActionName, keyof GenesisButtons> = {
  UP: "up",
  DOWN: "down",
  LEFT: "left",
  RIGHT: "right",
  A: "a",
  B: "b",
  C: "c",
  START: "start",
};

let KEY_TO_ACTION: Record<string, GenesisActionName> = {};
let GAMEPAD_MAP: GenesisGamepadBindingMaps = { buttons: new Map(), axes: [] };

export class LocalGenesisInputReader {
  private held = new Set<string>();

  constructor() {
    KEY_TO_ACTION = getNetplayGenesisKeyMap();
    GAMEPAD_MAP = getNetplayGenesisGamepadMap();
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.code in KEY_TO_ACTION) this.held.add(e.code);
  };

  private handleKeyUp = (e: KeyboardEvent) => {
    this.held.delete(e.code);
  };

  read(): number {
    let bits = 0;
    for (const code of this.held) {
      bits |= 1 << ACTION_TO_BIT.get(KEY_TO_ACTION[code])!;
    }

    // В netplay берём любой доступный геймпад для локального ввода (тот же
    // принцип, что у NES-версии в localInput.ts).
    const pads = navigator.getGamepads?.() || [];
    const pad = pads[0] || pads[1];
    if (pad) {
      for (const [index, action] of GAMEPAD_MAP.buttons) {
        if (pad.buttons[index]?.pressed) bits |= 1 << ACTION_TO_BIT.get(action)!;
      }
      for (const axisBinding of GAMEPAD_MAP.axes) {
        if (isAxisPressed(pad.axes[axisBinding.axisId] ?? 0, axisBinding.direction)) {
          bits |= 1 << ACTION_TO_BIT.get(axisBinding.action)!;
        }
      }
      // Левый стик по умолчанию дублирует D-pad независимо от пользовательской
      // раскладки — то же поведение "из коробки", что и у NES (localInput.ts).
      const [x = 0, y = 0] = pad.axes;
      if (y < -AXIS_THRESHOLD) bits |= 1 << ACTION_TO_BIT.get("UP")!;
      else if (y > AXIS_THRESHOLD) bits |= 1 << ACTION_TO_BIT.get("DOWN")!;
      if (x < -AXIS_THRESHOLD) bits |= 1 << ACTION_TO_BIT.get("LEFT")!;
      else if (x > AXIS_THRESHOLD) bits |= 1 << ACTION_TO_BIT.get("RIGHT")!;
    }

    return bits;
  }

  destroy() {
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
  }
}

/// Обратное преобразование битовой маски (см. LocalGenesisInputReader.read) в
/// GenesisButtons, которое ожидает GenesisCore.setInput().
export function decodeGenesisButtons(bits: number): GenesisButtons {
  const buttons: GenesisButtons = {};
  BUTTON_ORDER.forEach((action, index) => {
    if (bits & (1 << index)) buttons[ACTION_TO_KEY[action]] = true;
  });
  return buttons;
}
