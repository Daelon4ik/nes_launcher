// Конвертация кадра libretro (XRGB8888/RGB565/0RGB1555, little-endian) в плоский
// RGBA8888 — для отрисовки через canvas ImageData. Портировано (адаптировано под
// TS, без HW-render/PNG веток — genesis_plus_gx рендерит программно) из
// romdev-core-host/framebuffer.js (MIT, https://github.com/monteslu/romdev).
import { RETRO_PIXEL_FORMAT_0RGB1555, RETRO_PIXEL_FORMAT_RGB565, RETRO_PIXEL_FORMAT_XRGB8888 } from "./retroConstants";

export function framebufferToRgba(width: number, height: number, src: Uint8Array, pitch: number, format: number): Uint8Array {
  const dst = new Uint8Array(width * height * 4);

  if (format === RETRO_PIXEL_FORMAT_XRGB8888) {
    for (let y = 0; y < height; y++) {
      const srcRow = y * pitch;
      const dstRow = y * width * 4;
      for (let x = 0; x < width; x++) {
        const s = srcRow + x * 4;
        const d = dstRow + x * 4;
        dst[d + 0] = src[s + 2]; // R
        dst[d + 1] = src[s + 1]; // G
        dst[d + 2] = src[s + 0]; // B
        dst[d + 3] = 0xff;
      }
    }
  } else if (format === RETRO_PIXEL_FORMAT_RGB565) {
    for (let y = 0; y < height; y++) {
      const srcRow = y * pitch;
      const dstRow = y * width * 4;
      for (let x = 0; x < width; x++) {
        const s = srcRow + x * 2;
        const pix = src[s] | (src[s + 1] << 8);
        const r = (pix >> 11) & 0x1f;
        const g = (pix >> 5) & 0x3f;
        const b = pix & 0x1f;
        const d = dstRow + x * 4;
        dst[d + 0] = (r << 3) | (r >> 2);
        dst[d + 1] = (g << 2) | (g >> 4);
        dst[d + 2] = (b << 3) | (b >> 2);
        dst[d + 3] = 0xff;
      }
    }
  } else if (format === RETRO_PIXEL_FORMAT_0RGB1555) {
    for (let y = 0; y < height; y++) {
      const srcRow = y * pitch;
      const dstRow = y * width * 4;
      for (let x = 0; x < width; x++) {
        const s = srcRow + x * 2;
        const pix = src[s] | (src[s + 1] << 8);
        const r = (pix >> 10) & 0x1f;
        const g = (pix >> 5) & 0x1f;
        const b = pix & 0x1f;
        const d = dstRow + x * 4;
        dst[d + 0] = (r << 3) | (r >> 2);
        dst[d + 1] = (g << 3) | (g >> 2);
        dst[d + 2] = (b << 3) | (b >> 2);
        dst[d + 3] = 0xff;
      }
    }
  } else {
    throw new Error(`Unsupported pixel format ${format}`);
  }

  return dst;
}
