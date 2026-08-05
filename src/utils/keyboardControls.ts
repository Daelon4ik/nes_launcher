import { Controller } from "jsnes";

export type ActionName = "UP" | "DOWN" | "LEFT" | "RIGHT" | "A" | "B" | "START" | "SELECT";

export interface KeyBinding {
  keyCode: number; // for jsnes (deprecated but needed)
  code: string;    // for netplay (KeyboardEvent.code)
  name: string;    // display name
}

export type PlayerControls = Record<ActionName, KeyBinding>;

export const DEFAULT_CONTROLS: { player1: PlayerControls; player2: PlayerControls } = {
  player1: {
    UP: { keyCode: 38, code: "ArrowUp", name: "Up" },
    DOWN: { keyCode: 40, code: "ArrowDown", name: "Down" },
    LEFT: { keyCode: 37, code: "ArrowLeft", name: "Left" },
    RIGHT: { keyCode: 39, code: "ArrowRight", name: "Right" },
    A: { keyCode: 88, code: "KeyX", name: "X" },
    B: { keyCode: 90, code: "KeyZ", name: "Z" },
    START: { keyCode: 13, code: "Enter", name: "Enter" },
    SELECT: { keyCode: 17, code: "ControlRight", name: "Control" },
  },
  player2: {
    UP: { keyCode: 87, code: "KeyW", name: "W" },
    DOWN: { keyCode: 83, code: "KeyS", name: "S" },
    LEFT: { keyCode: 65, code: "KeyA", name: "A" },
    RIGHT: { keyCode: 68, code: "KeyD", name: "D" },
    A: { keyCode: 69, code: "KeyE", name: "E" },
    B: { keyCode: 81, code: "KeyQ", name: "Q" },
    START: { keyCode: 32, code: "Space", name: "Space" },
    SELECT: { keyCode: 16, code: "ShiftLeft", name: "Shift" },
  }
};

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

export function getSavedControls() {
  const saved = localStorage.getItem("keyboard_controls");
  if (saved) {
    try {
      return JSON.parse(saved) as typeof DEFAULT_CONTROLS;
    } catch (e) {
      console.error(e);
    }
  }
  return DEFAULT_CONTROLS;
}

export function saveControls(controls: typeof DEFAULT_CONTROLS) {
  localStorage.setItem("keyboard_controls", JSON.stringify(controls));
}

// Convert our config format to jsnes keys format
export function getJsnesKeysConfig() {
  const controls = getSavedControls();
  const keys: Record<number, [number, number, string]> = {};

  const mapPlayer = (player: 1 | 2, config: PlayerControls) => {
    for (const [action, binding] of Object.entries(config)) {
      const button = ACTION_TO_BUTTON[action as ActionName];
      keys[binding.keyCode] = [player, button, binding.name];
    }
  };

  mapPlayer(1, controls.player1);
  mapPlayer(2, controls.player2);
  
  return keys;
}

// Get mappings for netplay
export function getNetplayKeyMap() {
  const controls = getSavedControls();
  const map: Record<string, number> = {};
  
  for (const [action, binding] of Object.entries(controls.player1)) {
    map[binding.code] = ACTION_TO_BUTTON[action as ActionName];
  }
  for (const [action, binding] of Object.entries(controls.player2)) {
    map[binding.code] = ACTION_TO_BUTTON[action as ActionName];
  }
  
  return map;
}
