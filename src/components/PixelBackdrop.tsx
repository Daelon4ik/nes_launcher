// Фон-герой в стиле 8-bit: обложка ужимается до сетки ~96 «пикселей» по ширине,
// перекрашивается в палитру NES и растягивается обратно без сглаживания
// (image-rendering: pixelated). Вместо blur'а из прежнего дизайна — крупная
// пиксельная мозаика. См. docs/design.md#компоненты.
import { useEffect, useRef, type CSSProperties } from "react";

// Ширина мозаики в «пикселях»; высота считается по пропорциям контейнера.
const MOSAIC_WIDTH = 96;

// Палитра NES (2C02) без дубликатов чёрного — к ней «прилипает» каждый пиксель мозаики.
const NES_PALETTE: readonly [number, number, number][] = [
  [0x7c, 0x7c, 0x7c], [0x00, 0x00, 0xfc], [0x00, 0x00, 0xbc], [0x44, 0x28, 0xbc],
  [0x94, 0x00, 0x84], [0xa8, 0x00, 0x20], [0xa8, 0x10, 0x00], [0x88, 0x14, 0x00],
  [0x50, 0x30, 0x00], [0x00, 0x78, 0x00], [0x00, 0x68, 0x00], [0x00, 0x58, 0x00],
  [0x00, 0x40, 0x58], [0x00, 0x00, 0x00], [0xbc, 0xbc, 0xbc], [0x00, 0x78, 0xf8],
  [0x00, 0x58, 0xf8], [0x68, 0x44, 0xfc], [0xd8, 0x00, 0xcc], [0xe4, 0x00, 0x58],
  [0xf8, 0x38, 0x00], [0xe4, 0x5c, 0x10], [0xac, 0x7c, 0x00], [0x00, 0xb8, 0x00],
  [0x00, 0xa8, 0x00], [0x00, 0xa8, 0x44], [0x00, 0x88, 0x88], [0xf8, 0xf8, 0xf8],
  [0x3c, 0xbc, 0xfc], [0x68, 0x88, 0xfc], [0x98, 0x78, 0xf8], [0xf8, 0x78, 0xf8],
  [0xf8, 0x58, 0x98], [0xf8, 0x78, 0x58], [0xfc, 0xa0, 0x44], [0xf8, 0xb8, 0x00],
  [0xb8, 0xf8, 0x18], [0x58, 0xd8, 0x54], [0x58, 0xf8, 0x98], [0x00, 0xe8, 0xd8],
  [0x78, 0x78, 0x78], [0xfc, 0xfc, 0xfc], [0xa4, 0xe4, 0xfc], [0xb8, 0xb8, 0xf8],
  [0xd8, 0xb8, 0xf8], [0xf8, 0xb8, 0xf8], [0xf0, 0xd0, 0xb0], [0xfc, 0xe0, 0xa8],
  [0xf8, 0xd8, 0x78], [0xd8, 0xf8, 0x78], [0xb8, 0xf8, 0xb8], [0xb8, 0xf8, 0xd8],
  [0x00, 0xfc, 0xfc], [0xf8, 0xd8, 0xf8],
];

function nearestNesColor(r: number, g: number, b: number): [number, number, number] {
  let best = NES_PALETTE[0];
  let bestDist = Infinity;
  for (const color of NES_PALETTE) {
    const dr = r - color[0];
    const dg = g - color[1];
    const db = b - color[2];
    // Взвешенное расстояние — глаз чувствительнее к зелёному, чем к синему.
    const dist = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
    if (dist < bestDist) {
      bestDist = dist;
      best = color;
    }
  }
  return best;
}

function loadImage(src: string, crossOrigin: boolean): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

interface PixelBackdropProps {
  src: string | undefined;
  className?: string;
  style?: CSSProperties;
}

export function PixelBackdrop({ src, className, style }: PixelBackdropProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d", { willReadFrequently: true });
    if (!canvas || !ctx) return;

    const rect = canvas.getBoundingClientRect();
    const aspect = rect.width > 0 && rect.height > 0 ? rect.height / rect.width : 9 / 16;
    canvas.width = MOSAIC_WIDTH;
    canvas.height = Math.max(1, Math.round(MOSAIC_WIDTH * aspect));
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!src) return;

    let cancelled = false;

    (async () => {
      // Сначала пробуем с CORS — тогда canvas не «загрязняется» и можно перекрасить
      // пиксели в палитру NES. Если asset-протокол не отдаёт CORS-заголовки, грузим
      // без него: мозаика останется, просто в исходных цветах обложки.
      let img: HTMLImageElement;
      let readable = true;
      try {
        img = await loadImage(src, true);
      } catch {
        readable = false;
        try {
          img = await loadImage(src, false);
        } catch {
          return;
        }
      }
      if (cancelled) return;

      // object-fit: cover — обрезаем лишнее по длинной стороне.
      const scale = Math.max(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight);
      const w = img.naturalWidth * scale;
      const h = img.naturalHeight * scale;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);

      if (!readable) return;
      try {
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const px = data.data;
        for (let i = 0; i < px.length; i += 4) {
          const [r, g, b] = nearestNesColor(px[i], px[i + 1], px[i + 2]);
          px[i] = r;
          px[i + 1] = g;
          px[i + 2] = b;
        }
        ctx.putImageData(data, 0, 0);
      } catch {
        // canvas всё-таки tainted — оставляем мозаику без перекраски
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [src]);

  return <canvas ref={canvasRef} className={className} style={style} aria-hidden="true" />;
}
