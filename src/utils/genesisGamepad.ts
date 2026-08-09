import type { GenesisActionName } from "./genesisControls";
import { type GamepadSource, normalizeGamepadSource } from "./gamepadInput";

export type GenesisGamepadBinding = GamepadSource;

export type GenesisPlayerGamepadControls = Record<GenesisActionName, GenesisGamepadBinding>;

// Тот же дефолт, что был зашит константой в EmulatorScreen до переноса сюда:
// D-pad → стрелки, кнопки 0/1/2 → B/A/C, кнопка 9 → Start.
const STANDARD_LAYOUT: GenesisPlayerGamepadControls = {
  UP: { type: "button", buttonId: 12 },
  DOWN: { type: "button", buttonId: 13 },
  LEFT: { type: "button", buttonId: 14 },
  RIGHT: { type: "button", buttonId: 15 },
  B: { type: "button", buttonId: 0 },
  A: { type: "button", buttonId: 1 },
  C: { type: "button", buttonId: 2 },
  START: { type: "button", buttonId: 9 },
};

export const DEFAULT_GENESIS_GAMEPAD_CONTROLS: { player1: GenesisPlayerGamepadControls; player2: GenesisPlayerGamepadControls } = {
  player1: { ...STANDARD_LAYOUT },
  player2: { ...STANDARD_LAYOUT },
};

const STORAGE_KEY = "gamepad_controls_genesis";

function normalizeControls(controls: GenesisPlayerGamepadControls | undefined): GenesisPlayerGamepadControls {
  const result = {} as GenesisPlayerGamepadControls;
  for (const action of Object.keys(STANDARD_LAYOUT) as GenesisActionName[]) {
    result[action] = normalizeGamepadSource(controls?.[action], STANDARD_LAYOUT[action]);
  }
  return result;
}

export function getSavedGenesisGamepadControls() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved) as { player1: GenesisPlayerGamepadControls; player2: GenesisPlayerGamepadControls };
      return { player1: normalizeControls(parsed.player1), player2: normalizeControls(parsed.player2) };
    } catch (e) {
      console.error(e);
    }
  }
  return DEFAULT_GENESIS_GAMEPAD_CONTROLS;
}

export function saveGenesisGamepadControls(controls: typeof DEFAULT_GENESIS_GAMEPAD_CONTROLS) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(controls));
}

export interface GenesisAxisBinding {
  axisId: number;
  direction: 1 | -1;
  action: GenesisActionName;
}

export interface GenesisGamepadBindingMaps {
  // Физический индекс кнопки геймпада -> Genesis-экшен.
  buttons: Map<number, GenesisActionName>;
  axes: GenesisAxisBinding[];
}

function toBindingMaps(controls: GenesisPlayerGamepadControls): GenesisGamepadBindingMaps {
  const buttons = new Map<number, GenesisActionName>();
  const axes: GenesisAxisBinding[] = [];
  for (const [action, binding] of Object.entries(controls)) {
    if (binding.type === "axis") {
      axes.push({ axisId: binding.axisId, direction: binding.direction, action: action as GenesisActionName });
    } else {
      buttons.set(binding.buttonId, action as GenesisActionName);
    }
  }
  return { buttons, axes };
}

// Аналог getGamepadButtonMaps в jsnesGamepad.ts — EmulatorScreen опрашивает
// геймпады сам и назначает игроков по порядку подключения.
export function getGenesisGamepadButtonMaps(): [GenesisGamepadBindingMaps, GenesisGamepadBindingMaps] {
  const controls = getSavedGenesisGamepadControls();
  return [toBindingMaps(controls.player1), toBindingMaps(controls.player2)];
}

// Для netplay (см. src/netplay/genesisLocalInput.ts): там всегда только один
// локальный игрок, поэтому раскладки обоих слотов объединяются в одну плоскую
// карту — тот же принцип, что у getNetplayGamepadMap в jsnesGamepad.ts.
export function getNetplayGenesisGamepadMap(): GenesisGamepadBindingMaps {
  const controls = getSavedGenesisGamepadControls();
  const p1 = toBindingMaps(controls.player1);
  const p2 = toBindingMaps(controls.player2);
  const buttons = new Map(p1.buttons);
  for (const [buttonId, action] of p2.buttons) {
    buttons.set(buttonId, action);
  }
  return { buttons, axes: [...p1.axes, ...p2.axes] };
}
