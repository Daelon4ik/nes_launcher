// Пиксельные иконки 8-bit — см. docs/design.md#иконки.
// Каждая иконка — битмап-сетка ("#" — закрашенный пиксель), которая рисуется в SVG
// квадратами без сглаживания (shape-rendering: crispEdges). Размер иконки лучше
// брать кратным размеру сетки (12px-сетка → 24px, 8px-сетка → 16px), иначе
// пиксели получатся неравной ширины.
interface IconProps {
  size?: number;
}

type Grid = readonly string[];

function gridPath(grid: Grid): string {
  let d = "";
  grid.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] === "#") d += `M${x} ${y}h1v1h-1z`;
    }
  });
  return d;
}

// Контур фигуры: закрашенные пиксели, у которых хотя бы один сосед по стороне пуст.
function outline(grid: Grid): Grid {
  const filled = (x: number, y: number) => grid[y]?.[x] === "#";
  return grid.map((row, y) =>
    [...row]
      .map((cell, x) =>
        cell === "#" &&
        (!filled(x - 1, y) || !filled(x + 1, y) || !filled(x, y - 1) || !filled(x, y + 1))
          ? "#"
          : ".",
      )
      .join(""),
  );
}

// Поворот сетки на 90° по часовой стрелке.
function rotate(grid: Grid): Grid {
  return [...grid[0]].map((_, x) =>
    grid
      .map((row) => row[x])
      .reverse()
      .join(""),
  );
}

function PixelIcon({ grid, size }: { grid: Grid; size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${grid[0].length} ${grid.length}`}
      shapeRendering="crispEdges"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d={gridPath(grid)} />
    </svg>
  );
}

// Картридж — «Библиотека».
const CARTRIDGE: Grid = [
  ".##########.",
  ".#........#.",
  ".#.######.#.",
  ".#.#....#.#.",
  ".#.#....#.#.",
  ".#.######.#.",
  ".#........#.",
  ".#........#.",
  ".#.#.#.#..#.",
  ".#........#.",
  ".##########.",
  "..#.#..#.#..",
];

// Сумка — «Магазин».
const BAG: Grid = [
  "....####....",
  "...#....#...",
  "...#....#...",
  ".##########.",
  ".###.##.###.",
  ".##########.",
  ".##########.",
  ".##########.",
  ".##########.",
  ".##########.",
  ".##########.",
  "............",
];

const GEAR: Grid = [
  "....####....",
  ".##.####.##.",
  ".##########.",
  "..###..###..",
  "####....####",
  "###......###",
  "###......###",
  "####....####",
  "..###..###..",
  ".##########.",
  ".##.####.##.",
  "....####....",
];

const STAR: Grid = [
  ".....##.....",
  ".....##.....",
  "....####....",
  "############",
  ".##########.",
  "..########..",
  "...######...",
  "...######...",
  "..###..###..",
  "..##....##..",
  ".##......##.",
  "............",
];
const STAR_OUTLINE = outline(STAR);

const GAMEPAD: Grid = [
  "............",
  "............",
  "############",
  "#..........#",
  "#.#........#",
  "####....#.##",
  "#.#........#",
  "#..........#",
  "############",
  "............",
  "............",
  "............",
];

const ARROW_UP: Grid = [
  "...##...",
  "..####..",
  ".######.",
  "########",
  "...##...",
  "...##...",
  "...##...",
  "........",
];
const ARROW_RIGHT = rotate(ARROW_UP);
const ARROW_DOWN = rotate(ARROW_RIGHT);
const ARROW_LEFT = rotate(ARROW_DOWN);

export function LibraryIcon({ size = 24 }: IconProps) {
  return <PixelIcon grid={CARTRIDGE} size={size} />;
}

export function StoreIcon({ size = 24 }: IconProps) {
  return <PixelIcon grid={BAG} size={size} />;
}

export function GearIcon({ size = 24 }: IconProps) {
  return <PixelIcon grid={GEAR} size={size} />;
}

export function StarIcon({ size = 24, filled = false }: IconProps & { filled?: boolean }) {
  return <PixelIcon grid={filled ? STAR : STAR_OUTLINE} size={size} />;
}

export function GamepadIcon({ size = 24 }: IconProps) {
  return <PixelIcon grid={GAMEPAD} size={size} />;
}

export function ArrowUpIcon({ size = 16 }: IconProps) {
  return <PixelIcon grid={ARROW_UP} size={size} />;
}

export function ArrowDownIcon({ size = 16 }: IconProps) {
  return <PixelIcon grid={ARROW_DOWN} size={size} />;
}

export function ArrowLeftIcon({ size = 16 }: IconProps) {
  return <PixelIcon grid={ARROW_LEFT} size={size} />;
}

export function ArrowRightIcon({ size = 16 }: IconProps) {
  return <PixelIcon grid={ARROW_RIGHT} size={size} />;
}
