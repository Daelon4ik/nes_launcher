import type { GenesisActionName } from "./genesisControls";

export interface GenesisGamepadBinding {
  buttonId: number; // физический индекс кнопки в стандартной раскладке Gamepad API
}

export type GenesisPlayerGamepadControls = Record<GenesisActionName, GenesisGamepadBinding>;

// Тот же дефолт, что был зашит константой в EmulatorScreen до переноса сюда:
// D-pad → стрелки, кнопки 0/1/2 → B/A/C, кнопка 9 → Start.
const STANDARD_LAYOUT: GenesisPlayerGamepadControls = {
  UP: { buttonId: 12 },
  DOWN: { buttonId: 13 },
  LEFT: { buttonId: 14 },
  RIGHT: { buttonId: 15 },
  B: { buttonId: 0 },
  A: { buttonId: 1 },
  C: { buttonId: 2 },
  START: { buttonId: 9 },
};

export const DEFAULT_GENESIS_GAMEPAD_CONTROLS: { player1: GenesisPlayerGamepadControls; player2: GenesisPlayerGamepadControls } = {
  player1: { ...STANDARD_LAYOUT },
  player2: { ...STANDARD_LAYOUT },
};

const STORAGE_KEY = "gamepad_controls_genesis";

export function getSavedGenesisGamepadControls() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      return JSON.parse(saved) as typeof DEFAULT_GENESIS_GAMEPAD_CONTROLS;
    } catch (e) {
      console.error(e);
    }
  }
  return DEFAULT_GENESIS_GAMEPAD_CONTROLS;
}

export function saveGenesisGamepadControls(controls: typeof DEFAULT_GENESIS_GAMEPAD_CONTROLS) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(controls));
}

// Физический индекс кнопки геймпада -> Genesis-экшен.
function toButtonMap(controls: GenesisPlayerGamepadControls): Map<number, GenesisActionName> {
  const map = new Map<number, GenesisActionName>();
  for (const [action, binding] of Object.entries(controls)) {
    map.set(binding.buttonId, action as GenesisActionName);
  }
  return map;
}

// Аналог getGamepadButtonMaps в jsnesGamepad.ts — EmulatorScreen опрашивает
// геймпады сам и назначает игроков по порядку подключения.
export function getGenesisGamepadButtonMaps(): [Map<number, GenesisActionName>, Map<number, GenesisActionName>] {
  const controls = getSavedGenesisGamepadControls();
  return [toButtonMap(controls.player1), toButtonMap(controls.player2)];
}
