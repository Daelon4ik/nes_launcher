// Общая модель "откуда взять сигнал у геймпада" для ремаппинга — используется
// и NES-раскладкой (jsnesGamepad.ts), и Genesis-раскладкой (genesisGamepad.ts).
// Кнопка — дискретный сигнал из pad.buttons[N].pressed. Ось — аналоговый сигнал
// из pad.axes[N] (стики, а на части нестандартных геймпадов и триггеры RT/LT),
// который переводится в дискретное нажатие по порогу AXIS_THRESHOLD и знаку.
export type GamepadSource =
  | { type: "button"; buttonId: number }
  | { type: "axis"; axisId: number; direction: 1 | -1 };

export const AXIS_THRESHOLD = 0.5;

export function isAxisPressed(value: number, direction: 1 | -1, threshold = AXIS_THRESHOLD): boolean {
  return direction === 1 ? value > threshold : value < -threshold;
}

// Человекочитаемые имена физических кнопок для UI ремаппинга (стандартная
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

// Оси 0/1 — левый стик, 2/3 — правый стик в стандартной раскладке. RT/LT в
// стандартной раскладке приходят как buttons[6]/[7] (см. STANDARD_BUTTON_NAMES
// выше), но часть нестандартных геймпадов/драйверов репортит их как оси —
// для них подписи нет, используется дефолтная "Ось N".
const AXIS_LABELS: Record<number, { negative: string; positive: string }> = {
  0: { negative: "Левый стик ←", positive: "Левый стик →" },
  1: { negative: "Левый стик ↑", positive: "Левый стик ↓" },
  2: { negative: "Правый стик ←", positive: "Правый стик →" },
  3: { negative: "Правый стик ↑", positive: "Правый стик ↓" },
};

export function describeGamepadAxis(axisId: number, direction: 1 | -1): string {
  const label = AXIS_LABELS[axisId];
  if (label) return direction === 1 ? label.positive : label.negative;
  return `Ось ${axisId} ${direction === 1 ? "+" : "−"}`;
}

export function describeGamepadSource(source: GamepadSource): string {
  return source.type === "axis" ? describeGamepadAxis(source.axisId, source.direction) : describeGamepadButton(source.buttonId);
}

// Старые сохранённые раскладки (до появления поддержки стиков/триггеров-осей)
// хранили биндинг как { buttonId } без поля type — на лету дополняем его,
// чтобы не терять уже настроенные пользователем раскладки.
export function normalizeGamepadSource(raw: unknown, fallback: GamepadSource): GamepadSource {
  const binding = raw as { type?: string; buttonId?: number; axisId?: number; direction?: number } | null | undefined;
  if (binding?.type === "axis" && typeof binding.axisId === "number") {
    return { type: "axis", axisId: binding.axisId, direction: binding.direction === -1 ? -1 : 1 };
  }
  if (typeof binding?.buttonId === "number") {
    return { type: "button", buttonId: binding.buttonId };
  }
  return fallback;
}

// Ищет впервые нажатую (не бывшую нажатой на предыдущем кадре) кнопку.
export function findNewlyPressedButton(pad: Gamepad, wasPressed: boolean[]): number {
  return pad.buttons.findIndex((b, i) => b.pressed && !wasPressed[i]);
}

// Ищет ось, впервые пересёкшую порог AXIS_THRESHOLD (в любую сторону) с
// предыдущего кадра — используется в UI ремаппинга для назначения стика/оси.
export function findNewlyCrossedAxis(pad: Gamepad, wasAxes: number[]): { axisId: number; direction: 1 | -1 } | null {
  for (let i = 0; i < pad.axes.length; i++) {
    const value = pad.axes[i];
    const prevValue = wasAxes[i] ?? 0;
    if (isAxisPressed(value, 1) && !isAxisPressed(prevValue, 1)) return { axisId: i, direction: 1 };
    if (isAxisPressed(value, -1) && !isAxisPressed(prevValue, -1)) return { axisId: i, direction: -1 };
  }
  return null;
}
