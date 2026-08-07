// Раскладка клавиатуры для Genesis (3-кнопочный пад: A/B/C/Start) — аналог
// keyboardControls.ts для NES, но отдельный неймспейс localStorage и набор
// экшенов (нет Select, есть C). См. docs/platforms.md#контроллер.
export type GenesisActionName = "UP" | "DOWN" | "LEFT" | "RIGHT" | "A" | "B" | "C" | "START";

export interface GenesisKeyBinding {
  code: string; // KeyboardEvent.code
  name: string; // отображаемое имя
}

export type GenesisPlayerControls = Record<GenesisActionName, GenesisKeyBinding>;

export const DEFAULT_GENESIS_CONTROLS: { player1: GenesisPlayerControls; player2: GenesisPlayerControls } = {
  player1: {
    UP: { code: "ArrowUp", name: "Up" },
    DOWN: { code: "ArrowDown", name: "Down" },
    LEFT: { code: "ArrowLeft", name: "Left" },
    RIGHT: { code: "ArrowRight", name: "Right" },
    A: { code: "KeyZ", name: "Z" },
    B: { code: "KeyX", name: "X" },
    C: { code: "KeyC", name: "C" },
    START: { code: "Enter", name: "Enter" },
  },
  player2: {
    UP: { code: "KeyW", name: "W" },
    DOWN: { code: "KeyS", name: "S" },
    LEFT: { code: "KeyA", name: "A" },
    RIGHT: { code: "KeyD", name: "D" },
    A: { code: "KeyG", name: "G" },
    B: { code: "KeyH", name: "H" },
    C: { code: "KeyJ", name: "J" },
    START: { code: "Space", name: "Space" },
  },
};

// Отдельный от NES ключ (не keyboard_controls_nes/keyboard_controls_genesis, как
// изначально прикидывалось в platforms.md) — NES-ключ остался плоским
// (keyboard_controls), переименовывать существующие пользовательские раскладки
// ради симметрии не стали; для Genesis просто заводим новый ключ.
const STORAGE_KEY = "keyboard_controls_genesis";

export function getSavedGenesisControls() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      return JSON.parse(saved) as typeof DEFAULT_GENESIS_CONTROLS;
    } catch (e) {
      console.error(e);
    }
  }
  return DEFAULT_GENESIS_CONTROLS;
}

export function saveGenesisControls(controls: typeof DEFAULT_GENESIS_CONTROLS) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(controls));
}

// e.code -> [индекс игрока (0|1, как у GenesisCore.setInput), экшен]. Аналог
// getCodeBasedKeyMap в keyboardControls.ts.
export function getGenesisCodeBasedKeyMap(): Record<string, [0 | 1, GenesisActionName]> {
  const controls = getSavedGenesisControls();
  const map: Record<string, [0 | 1, GenesisActionName]> = {};

  for (const [action, binding] of Object.entries(controls.player1)) {
    map[binding.code] = [0, action as GenesisActionName];
  }
  for (const [action, binding] of Object.entries(controls.player2)) {
    map[binding.code] = [1, action as GenesisActionName];
  }

  return map;
}
