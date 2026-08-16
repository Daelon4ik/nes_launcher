// Минимальный libretro-фронтенд поверх genesis_plus_gx (Sega Genesis/Mega Drive),
// скомпилированного в WASM пакетом romdev-core-gpgx (см. docs/platforms.md).
// Роль этого класса — прямой аналог jsnes `NES`: пошаговый вызов кадра,
// video/audio буферы, ввод, save state. EmulatorScreen дёргает его так же,
// как сейчас `nes.frame()`/`nes.buttonDown`/`nes.toJSON()` для NES-игр.
//
// Скомпилированный .js-глей ядра захардкожен под Node (ENVIRONMENT_IS_NODE)
// сборкой romdev — патчится под браузер через patch-package
// (patches/romdev-core-gpgx+0.14.0.patch), см. комментарий там же.
import wasmUrl from "romdev-core-gpgx/wasm/genesis_plus_gx_libretro.wasm?url";
import { newCallbackState, registerCallbacks, type CallbackState, type EmscriptenModule } from "./callbacks";
import { framebufferToRgba } from "./framebuffer";
import { RETRO_DEVICE_JOYPAD } from "./retroConstants";

export interface GenesisButtons {
  up?: boolean;
  down?: boolean;
  left?: boolean;
  right?: boolean;
  a?: boolean;
  b?: boolean;
  c?: boolean;
  start?: boolean;
}

function encodeCString(str: string): Uint8Array {
  const bytes = new TextEncoder().encode(str);
  const out = new Uint8Array(bytes.length + 1);
  out.set(bytes);
  return out;
}

function buttonsToMask(input: GenesisButtons): number {
  // libretro RetroPad bits, как их читает genesis_plus_gx для 3-кнопочного пада
  // (b=0 → Genesis B, y=1 → Genesis C, start=3, d-pad=4..7, a=8 → Genesis A).
  let m = 0;
  if (input.b) m |= 1 << 0;
  if (input.c) m |= 1 << 1;
  if (input.start) m |= 1 << 3;
  if (input.up) m |= 1 << 4;
  if (input.down) m |= 1 << 5;
  if (input.left) m |= 1 << 6;
  if (input.right) m |= 1 << 7;
  if (input.a) m |= 1 << 8;
  return m;
}

export class GenesisCore {
  private mod: EmscriptenModule;
  private state: CallbackState;

  width = 320;
  height = 224;
  sampleRate = 44100;
  fps = 60;

  private constructor(mod: EmscriptenModule, state: CallbackState) {
    this.mod = mod;
    this.state = state;
  }

  static async create(): Promise<GenesisCore> {
    const [{ default: createGenesisPlusGx }, wasmBinary] = await Promise.all([
      import("romdev-core-gpgx/wasm/genesis_plus_gx_libretro.js"),
      fetch(wasmUrl)
        .then((r) => r.arrayBuffer())
        .then((buf) => new Uint8Array(buf)),
    ]);

    const mod = await createGenesisPlusGx({
      noInitialRun: true,
      wasmBinary,
      print: () => {},
      printErr: (s: string) => console.error("[genesis_plus_gx]", s),
    });

    const state = newCallbackState("/romdev-system", "/romdev-save");
    registerCallbacks(mod, state);
    mod._retro_init();

    return new GenesisCore(mod, state);
  }

  /** Грузит ROM и прокручивает несколько кадров разгона VDP (ядро стартует в
   *  256×192 по умолчанию, большинство игр переключаются на 320×224 в первых
   *  кадрах инициализации — см. тот же приём в romdev-core-host). */
  loadRom(romData: Uint8Array) {
    const mod = this.mod;
    mod.FS.writeFile("/rom.gen", romData);

    const dataPtr = mod._malloc(romData.length);
    mod.HEAPU8.set(romData, dataPtr);
    const pathBytes = encodeCString("/rom.gen");
    const pathPtr = mod._malloc(pathBytes.length);
    mod.HEAPU8.set(pathBytes, pathPtr);

    const infoPtr = mod._malloc(16);
    mod.setValue(infoPtr + 0, pathPtr, "i32");
    mod.setValue(infoPtr + 4, dataPtr, "i32");
    mod.setValue(infoPtr + 8, romData.length, "i32");
    mod.setValue(infoPtr + 12, 0, "i32");

    const ok = mod._retro_load_game(infoPtr);
    mod._free(infoPtr);
    if (!ok) {
      throw new Error("Ядро genesis_plus_gx отказалось загружать этот ROM");
    }

    mod._retro_set_controller_port_device(0, RETRO_DEVICE_JOYPAD);
    mod._retro_set_controller_port_device(1, RETRO_DEVICE_JOYPAD);

    const avInfoPtr = mod._malloc(64);
    mod._retro_get_system_av_info(avInfoPtr);
    this.width = mod.getValue(avInfoPtr + 0, "i32");
    this.height = mod.getValue(avInfoPtr + 4, "i32");
    // retro_system_timing идёт сразу после retro_game_geometry (20 байт), выровненная
    // до 8 байт под double — отсюда паддинг в 4 байта перед fps/sample_rate.
    this.fps = mod.getValue(avInfoPtr + 24, "double") || 60;
    this.sampleRate = mod.getValue(avInfoPtr + 32, "double") || 44100;
    mod._free(avInfoPtr);

    const MAX_SETTLE = 64;
    const FRAMES_AFTER_FIRST_REFRESH = 4;
    const beforeRefresh = this.state.lastFrame;
    let firstRefreshAt = -1;
    for (let stepped = 1; stepped <= MAX_SETTLE; stepped++) {
      mod._retro_run();
      if (firstRefreshAt < 0 && this.state.lastFrame && this.state.lastFrame !== beforeRefresh) {
        firstRefreshAt = stepped;
      }
      if (firstRefreshAt > 0 && stepped >= firstRefreshAt + FRAMES_AFTER_FIRST_REFRESH) break;
    }
    // Разгонные кадры не должны попасть в аудио-очередь, которую EmulatorScreen
    // начнёт проигрывать только после этого метода.
    this.state.audioRing.length = 0;
    if (this.state.lastFrame) {
      this.width = this.state.lastFrame.width;
      this.height = this.state.lastFrame.height;
    }
  }

  setInput(port: 0 | 1, buttons: GenesisButtons) {
    this.state.inputPorts[port] = buttonsToMask(buttons);
  }

  /** Один кадр эмуляции — прямой аналог `nes.frame()`. */
  frame() {
    this.mod._retro_run();
  }

  /** RGBA8888-кадр для отрисовки на canvas, либо null (кадр ещё не готов). */
  getFrameRgba(): { width: number; height: number; rgba: Uint8Array } | null {
    const frame = this.state.lastFrame;
    if (!frame) return null;
    return { width: frame.width, height: frame.height, rgba: framebufferToRgba(frame.width, frame.height, frame.pixels, frame.pitch, frame.format) };
  }

  /** Забирает и очищает накопленные с прошлого вызова стерео-сэмплы (S16, interleaved). */
  drainAudio(): Int16Array {
    if (this.state.audioRing.length === 0) return new Int16Array(0);
    let total = 0;
    for (const chunk of this.state.audioRing) total += chunk.length;
    const out = new Int16Array(total);
    let offset = 0;
    for (const chunk of this.state.audioRing) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    this.state.audioRing.length = 0;
    return out;
  }

  serializeState(): Uint8Array {
    const mod = this.mod;
    const size = mod._retro_serialize_size();
    if (!size) throw new Error("Ядро вернуло нулевой размер save state");
    const ptr = mod._malloc(size);
    try {
      if (!mod._retro_serialize(ptr, size)) throw new Error("retro_serialize вернул ошибку");
      return new Uint8Array(mod.HEAPU8.buffer, ptr, size).slice();
    } finally {
      mod._free(ptr);
    }
  }

  unserializeState(blob: Uint8Array) {
    const mod = this.mod;
    const ptr = mod._malloc(blob.byteLength);
    try {
      mod.HEAPU8.set(blob, ptr);
      if (!mod._retro_unserialize(ptr, blob.byteLength)) throw new Error("Ядро отклонило save state (не подходит для этого ROM)");
    } finally {
      mod._free(ptr);
    }
  }

  reset() {
    this.mod._retro_reset();
  }

  destroy() {
    this.mod._retro_deinit();
  }
}

/** Save state (см. GenesisCore.serializeState) хранится бэкендом как непрозрачная
 *  строка (тот же `SaveState.file_path`, что и jsnes-снимки, см. docs/data-model.md) —
 *  кодируем бинарный блоб в base64. Чанками, чтобы не упереться в лимит аргументов
 *  движка на `String.fromCharCode(...bigArray)` (снимок ядра ~1МБ). */
export function genesisStateToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function genesisStateFromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
