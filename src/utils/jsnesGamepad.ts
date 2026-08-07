import { Controller } from "jsnes";
import type { ActionName } from "./keyboardControls";
import { type GamepadSource, describeGamepadButton, describeGamepadSource, normalizeGamepadSource } from "./gamepadInput";

export type GamepadBinding = GamepadSource;

export type PlayerGamepadControls = Record<ActionName, GamepadBinding>;

// jsnes не поставляет дефолтный конфиг геймпада сам — раскладка под стандартный
// Gamepad API (W3C "standard" layout) одинакова для обоих игроков по умолчанию,
// чтобы обычный Xbox/PS-совместимый геймпад работал сразу, без ручной настройки.
const STANDARD_LAYOUT: PlayerGamepadControls = {
  UP: { type: "button", buttonId: 12 },
  DOWN: { type: "button", buttonId: 13 },
  LEFT: { type: "button", buttonId: 14 },
  RIGHT: { type: "button", buttonId: 15 },
  A: { type: "button", buttonId: 0 },
  B: { type: "button", buttonId: 1 },
  SELECT: { type: "button", buttonId: 8 },
  START: { type: "button", buttonId: 9 },
};

export const DEFAULT_GAMEPAD_CONTROLS: { player1: PlayerGamepadControls; player2: PlayerGamepadControls } = {
  player1: { ...STANDARD_LAYOUT },
  player2: { ...STANDARD_LAYOUT },
};

const STORAGE_KEY = "gamepad_controls";

function normalizeControls(controls: PlayerGamepadControls | undefined): PlayerGamepadControls {
  const result = {} as PlayerGamepadControls;
  for (const action of Object.keys(STANDARD_LAYOUT) as ActionName[]) {
    result[action] = normalizeGamepadSource(controls?.[action], STANDARD_LAYOUT[action]);
  }
  return result;
}

export function getSavedGamepadControls() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved) as { player1: PlayerGamepadControls; player2: PlayerGamepadControls };
      return { player1: normalizeControls(parsed.player1), player2: normalizeControls(parsed.player2) };
    } catch (e) {
      console.error(e);
    }
  }
  return DEFAULT_GAMEPAD_CONTROLS;
}

export function saveGamepadControls(controls: typeof DEFAULT_GAMEPAD_CONTROLS) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(controls));
}

const ACTION_TO_BUTTON: Record<ActionName, number> = {
  UP: Controller.BUTTON_UP,
  DOWN: Controller.BUTTON_DOWN,
  LEFT: Controller.BUTTON_LEFT,
  RIGHT: Controller.BUTTON_RIGHT,
  A: Controller.BUTTON_A,
  B: Controller.BUTTON_B,
  START: Controller.BUTTON_START,
  SELECT: Controller.BUTTON_SELECT,
};

export interface AxisBinding {
  axisId: number;
  direction: 1 | -1;
  nesButton: number;
}

export interface GamepadBindingMaps {
  // Физический индекс кнопки геймпада -> NES-кнопка (Controller.BUTTON_*).
  buttons: Map<number, number>;
  axes: AxisBinding[];
}

function toBindingMaps(controls: PlayerGamepadControls): GamepadBindingMaps {
  const buttons = new Map<number, number>();
  const axes: AxisBinding[] = [];
  for (const [action, binding] of Object.entries(controls)) {
    const nesButton = ACTION_TO_BUTTON[action as ActionName];
    if (binding.type === "axis") {
      axes.push({ axisId: binding.axisId, direction: binding.direction, nesButton });
    } else {
      buttons.set(binding.buttonId, nesButton);
    }
  }
  return { buttons, axes };
}

// Не используем встроенный GamepadController у jsnes — тот привязывает раскладку
// по строковому id устройства (gamepad.id) и не различает двух игроков с
// одинаковой моделью контроллера (у обоих один и тот же id). Вместо этого
// EmulatorScreen опрашивает геймпады сам и назначает игроков по порядку
// подключения (первый геймпад — Игрок 1, второй — Игрок 2), используя эти карты.
export function getGamepadButtonMaps(): [GamepadBindingMaps, GamepadBindingMaps] {
  const controls = getSavedGamepadControls();
  return [toBindingMaps(controls.player1), toBindingMaps(controls.player2)];
}

// Для netplay (см. src/netplay/localInput.ts): там всегда только один локальный
// игрок, поэтому раскладки обоих слотов объединяются в одну плоскую карту — тот
// же принцип, что у getNetplayKeyMap в keyboardControls.ts.
export function getNetplayGamepadMap(): GamepadBindingMaps {
  const controls = getSavedGamepadControls();
  const p1 = toBindingMaps(controls.player1);
  const p2 = toBindingMaps(controls.player2);
  const buttons = new Map(p1.buttons);
  for (const [buttonId, nesButton] of p2.buttons) {
    buttons.set(buttonId, nesButton);
  }
  return { buttons, axes: [...p1.axes, ...p2.axes] };
}

export { describeGamepadButton, describeGamepadSource };
