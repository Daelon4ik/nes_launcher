import { Controller } from "jsnes";

interface GamepadButtonConfig {
  type: "button" | "axis";
  code: number;
  buttonId: number;
}

interface JsnesGamepadConfig {
  playerGamepadId: [string | null, string | null];
  configs: Record<string, { buttons: GamepadButtonConfig[] }>;
}

// jsnes не поставляет дефолтный конфиг геймпада — без него он просто игнорирует
// геймпад, пока пользователь не пройдёт мастер настройки (нажатие каждой кнопки).
// Собираем конфиг под стандартный маппинг Gamepad API (W3C "standard" layout) сами,
// чтобы обычный Xbox/PS-совместимый геймпад работал сразу, без ручной настройки.
// Поддерживаем до двух геймпадов для локального мультиплеера.
export function standardGamepadConfig(gamepadIds: string[]): JsnesGamepadConfig {
  const configs: Record<string, { buttons: GamepadButtonConfig[] }> = {};
  
  for (const id of gamepadIds) {
    if (!id || configs[id]) continue;
    configs[id] = {
      buttons: [
        { type: "button", code: 0, buttonId: Controller.BUTTON_A },
        { type: "button", code: 1, buttonId: Controller.BUTTON_B },
        { type: "button", code: 8, buttonId: Controller.BUTTON_SELECT },
        { type: "button", code: 9, buttonId: Controller.BUTTON_START },
        { type: "button", code: 12, buttonId: Controller.BUTTON_UP },
        { type: "button", code: 13, buttonId: Controller.BUTTON_DOWN },
        { type: "button", code: 14, buttonId: Controller.BUTTON_LEFT },
        { type: "button", code: 15, buttonId: Controller.BUTTON_RIGHT },
      ],
    };
  }

  return {
    playerGamepadId: [gamepadIds[0] || null, gamepadIds[1] || null],
    configs,
  };
}
