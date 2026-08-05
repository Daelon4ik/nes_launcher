// Навигация геймпадом/клавиатурой между элементами с [data-nav] внутри контейнера.
// См. docs/design.md#управление-с-геймпада
import { useEffect, type RefObject } from "react";

type Direction = "up" | "down" | "left" | "right";

const NAV_SELECTOR = "[data-nav]";
const REPEAT_MS = 220;
const AXIS_THRESHOLD = 0.5;
const CONFIRM_BUTTON = 0; // A / Cross
const DPAD_BUTTONS: Record<number, Direction> = {
  12: "up",
  13: "down",
  14: "left",
  15: "right",
};
const ARROW_KEYS: Record<string, Direction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

const TEXTUAL_INPUT_TYPES = new Set(["text", "search", "email", "url", "tel", "password", "number"]);

// Внутри текстового поля стрелки должны двигать курсор, а не фокус —
// иначе набор текста с клавиатуры (fallback-путь для геймпада) был бы невозможен.
function isTextCaretTarget(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) return TEXTUAL_INPUT_TYPES.has(target.type);
  return false;
}

function focusNearest(current: HTMLElement, direction: Direction, container: HTMLElement) {
  const candidates = Array.from(container.querySelectorAll<HTMLElement>(NAV_SELECTOR)).filter(
    (el) => el !== current,
  );
  const from = current.getBoundingClientRect();
  const fromCenter = { x: from.left + from.width / 2, y: from.top + from.height / 2 };

  let best: HTMLElement | null = null;
  let bestScore = Infinity;

  for (const el of candidates) {
    const rect = el.getBoundingClientRect();
    const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const dx = center.x - fromCenter.x;
    const dy = center.y - fromCenter.y;

    const inDirection =
      direction === "up"
        ? dy < -1
        : direction === "down"
          ? dy > 1
          : direction === "left"
            ? dx < -1
            : dx > 1;
    if (!inDirection) continue;

    const isVertical = direction === "up" || direction === "down";
    const primary = Math.abs(isVertical ? dy : dx);
    const secondary = Math.abs(isVertical ? dx : dy);
    const score = primary + secondary * 2;

    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }

  best?.focus();
}

export function useSpatialNavigation(containerRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function move(direction: Direction) {
      const current = document.activeElement;
      if (current instanceof HTMLElement && container!.contains(current)) {
        focusNearest(current, direction, container!);
      } else {
        container!.querySelector<HTMLElement>(NAV_SELECTOR)?.focus();
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      const direction = ARROW_KEYS[e.key];
      if (!direction) return;

      if (isTextCaretTarget(e.target)) {
        if (e.target instanceof HTMLTextAreaElement) return; // курсор во все стороны
        if (direction === "left" || direction === "right") return; // курсор влево/вправо
      }

      e.preventDefault();
      move(direction);
    }
    container.addEventListener("keydown", onKeyDown);

    let lastMoveAt = 0;
    let heldDirection: Direction | null = null;
    let confirmHeld = false;
    let rafId: number;

    function pollGamepad() {
      const pad = navigator.getGamepads?.()[0];
      if (pad) {
        let direction: Direction | null = null;
        for (const [index, dir] of Object.entries(DPAD_BUTTONS)) {
          if (pad.buttons[Number(index)]?.pressed) direction = dir;
        }
        if (!direction) {
          const [x = 0, y = 0] = pad.axes;
          if (y < -AXIS_THRESHOLD) direction = "up";
          else if (y > AXIS_THRESHOLD) direction = "down";
          else if (x < -AXIS_THRESHOLD) direction = "left";
          else if (x > AXIS_THRESHOLD) direction = "right";
        }

        const now = performance.now();
        if (direction && (direction !== heldDirection || now - lastMoveAt > REPEAT_MS)) {
          move(direction);
          lastMoveAt = now;
        }
        heldDirection = direction;

        const confirmPressed = pad.buttons[CONFIRM_BUTTON]?.pressed ?? false;
        if (confirmPressed && !confirmHeld) {
          const current = document.activeElement;
          if (current instanceof HTMLElement && container!.contains(current)) {
            current.click();
          }
        }
        confirmHeld = confirmPressed;
      }
      rafId = requestAnimationFrame(pollGamepad);
    }
    rafId = requestAnimationFrame(pollGamepad);

    return () => {
      container.removeEventListener("keydown", onKeyDown);
      cancelAnimationFrame(rafId);
    };
  }, [containerRef]);
}
