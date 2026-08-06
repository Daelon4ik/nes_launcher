import { Controller } from "jsnes";
import type { ActionName } from "./keyboardControls";

export interface GamepadBinding {
  buttonId: number; // физический индекс кнопки в стандартной раскладке Gamepad API
}

export type PlayerGamepadControls = Record<ActionName, GamepadBinding>;

// jsnes не поставляет дефолтный конфиг геймпада сам — раскладка под стандартный
// Gamepad API (W3C "standard" layout) одинакова для обоих игроков по умолчанию,
// чтобы обычный Xbox/PS-совместимый геймпад работал сразу, без ручной настройки.
const STANDARD_LAYOUT: PlayerGamepadControls = {
  UP: { buttonId: 12 },
  DOWN: { buttonId: 13 },
  LEFT: { buttonId: 14 },
  RIGHT: { buttonId: 15 },
  A: { buttonId: 0 },
  B: { buttonId: 1 },
  SELECT: { buttonId: 8 },
  START: { buttonId: 9 },
};

export const DEFAULT_GAMEPAD_CONTROLS: { player1: PlayerGamepadControls; player2: PlayerGamepadControls } = {
  player1: { ...STANDARD_LAYOUT },
  player2: { ...STANDARD_LAYOUT },
};

const STORAGE_KEY = "gamepad_controls";

export function getSavedGamepadControls() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      return JSON.parse(saved) as typeof DEFAULT_GAMEPAD_CONTROLS;
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

// Физический индекс кнопки геймпада -> NES-кнопка (Controller.BUTTON_*).
function toButtonMap(controls: PlayerGamepadControls): Map<number, number> {
  const map = new Map<number, number>();
  for (const [action, binding] of Object.entries(controls)) {
    map.set(binding.buttonId, ACTION_TO_BUTTON[action as ActionName]);
  }
  return map;
}

// Не используем встроенный GamepadController у jsnes — тот привязывает раскладку
// по строковому id устройства (gamepad.id) и не различает двух игроков с
// одинаковой моделью контроллера (у обоих один и тот же id). Вместо этого
// EmulatorScreen опрашивает геймпады сам и назначает игроков по порядку
// подключения (первый геймпад — Игрок 1, второй — Игрок 2), используя эти карты.
export function getGamepadButtonMaps(): [Map<number, number>, Map<number, number>] {
  const controls = getSavedGamepadControls();
  return [toButtonMap(controls.player1), toButtonMap(controls.player2)];
}

// Для netplay (см. src/netplay/localInput.ts): там всегда только один локальный
// игрок, поэтому раскладки обоих слотов объединяются в одну плоскую карту — тот
// же принцип, что у getNetplayKeyMap в keyboardControls.ts.
export function getNetplayGamepadMap(): Map<number, number> {
  const controls = getSavedGamepadControls();
  const map = toButtonMap(controls.player1);
  for (const [buttonId, nesButton] of toButtonMap(controls.player2)) {
    map.set(buttonId, nesButton);
  }
  return map;
}

// Человекочитаемое имя физической кнопки для UI ремаппинга (стандартная
// раскладка Gamepad API, https://w3c.github.io/gamepad/#remapping) — сами
// кнопки не несут имени в Gamepad API, поэтому подписываем по стандартным
// позициям Xbox/PS-совместимого геймпада.
const STANDARD_BUTTON_NAMES: Record<number, string> = {
  0: "A", 1: "B", 2: "X", 3: "Y",
  4: "LB", 5: "RB", 6: "LT", 7: "RT",
  8: "Select", 9: "Start", 10: "L3", 11: "R3",
  12: "D-pad ↑", 13: "D-pad ↓", 14: "D-pad ←", 15: "D-pad →",
  16: "Home",
};

export function describeGamepadButton(buttonId: number): string {
  return STANDARD_BUTTON_NAMES[buttonId] ?? `Кнопка ${buttonId}`;
}
