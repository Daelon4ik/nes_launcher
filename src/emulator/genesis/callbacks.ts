// Регистрация обязательных колбэков libretro (environment, video_refresh,
// audio_sample[_batch], input_poll, input_state) на Emscripten-модуле ядра.
// Портировано (адаптировано под TS, без proxied/HW-render/C64-специфичных
// веток — они не нужны genesis_plus_gx, программному 2D-ядру) из
// romdev-core-host/callbacks.js (MIT, https://github.com/monteslu/romdev).
import {
  RETRO_ENVIRONMENT_EXPERIMENTAL,
  RETRO_PIXEL_FORMAT_0RGB1555,
  RETRO_PIXEL_FORMAT_RGB565,
  RETRO_PIXEL_FORMAT_XRGB8888,
  RETRO_DEVICE_JOYPAD,
} from "./retroConstants";

export interface EmscriptenModule {
  HEAPU8: Uint8Array;
  addFunction(fn: (...args: number[]) => number | void, signature: string): number;
  setValue(ptr: number, value: number, type: string): void;
  getValue(ptr: number, type: string): number;
  UTF8ToString(ptr: number): string;
  _malloc(size: number): number;
  _free(ptr: number): void;
  FS: { writeFile(path: string, data: Uint8Array): void };
  _retro_api_version(): number;
  _retro_init(): void;
  _retro_deinit(): void;
  _retro_set_environment(cb: number): void;
  _retro_set_video_refresh(cb: number): void;
  _retro_set_audio_sample(cb: number): void;
  _retro_set_audio_sample_batch(cb: number): void;
  _retro_set_input_poll(cb: number): void;
  _retro_set_input_state(cb: number): void;
  _retro_set_controller_port_device(port: number, device: number): void;
  _retro_load_game(infoPtr: number): number;
  _retro_get_system_av_info(avInfoPtr: number): void;
  _retro_run(): void;
  _retro_reset(): void;
  _retro_serialize_size(): number;
  _retro_serialize(ptr: number, size: number): number;
  _retro_unserialize(ptr: number, size: number): number;
}

export interface Frame {
  width: number;
  height: number;
  pitch: number;
  format: number;
  pixels: Uint8Array;
}

export interface CallbackState {
  pixelFormat: number;
  lastFrame: Frame | null;
  audioRing: Int16Array[];
  inputPorts: [number, number];
  coreVariables: Map<string, { value: string }>;
  variablesUpdated: boolean;
  systemDir: string;
  saveDir: string;
}

export function newCallbackState(systemDir: string, saveDir: string): CallbackState {
  return {
    pixelFormat: RETRO_PIXEL_FORMAT_0RGB1555,
    lastFrame: null,
    audioRing: [],
    inputPorts: [0, 0],
    coreVariables: new Map(),
    variablesUpdated: false,
    systemDir,
    saveDir,
  };
}

function encodeCString(str: string): Uint8Array {
  const bytes = new TextEncoder().encode(str);
  const out = new Uint8Array(bytes.length + 1);
  out.set(bytes);
  return out;
}

function allocString(mod: EmscriptenModule, str: string): number {
  const bytes = encodeCString(str);
  const ptr = mod._malloc(bytes.length);
  mod.HEAPU8.set(bytes, ptr);
  return ptr;
}

/** Регистрирует все обязательные колбэки. Вызывать ДО `_retro_init()`. */
export function registerCallbacks(mod: EmscriptenModule, state: CallbackState) {
  const envCb = mod.addFunction((cmd: number, dataPtr: number) => (handleEnv(mod, state, cmd, dataPtr) ? 1 : 0), "iii");
  mod._retro_set_environment(envCb);

  const videoCb = mod.addFunction((dataPtr: number, w: number, h: number, pitch: number) => {
    if (dataPtr === 0) return;
    const bytes = h * pitch;
    state.lastFrame = {
      width: w,
      height: h,
      pitch,
      format: state.pixelFormat,
      pixels: new Uint8Array(mod.HEAPU8.subarray(dataPtr, dataPtr + bytes)),
    };
  }, "viiii");
  mod._retro_set_video_refresh(videoCb);

  const audioBatchCb = mod.addFunction((dataPtr: number, frames: number) => {
    if (dataPtr === 0 || frames === 0) return frames;
    const samples = new Int16Array(mod.HEAPU8.buffer, dataPtr, frames * 2).slice();
    state.audioRing.push(samples);
    return frames;
  }, "iii");
  mod._retro_set_audio_sample_batch(audioBatchCb);

  const audioOneCb = mod.addFunction((left: number, right: number) => {
    state.audioRing.push(Int16Array.of(left, right));
  }, "vii");
  mod._retro_set_audio_sample(audioOneCb);

  const inputPollCb = mod.addFunction(() => {}, "v");
  mod._retro_set_input_poll(inputPollCb);

  const inputStateCb = mod.addFunction((port: number, _device: number, _idx: number, id: number) => {
    const bits = state.inputPorts[port] ?? 0;
    if (id === 256) return bits; // RETRO_DEVICE_ID_JOYPAD_MASK
    return bits & (1 << id) ? 1 : 0;
  }, "iiiii");
  mod._retro_set_input_state(inputStateCb);
}

// Env command IDs (см. libretro.h RETRO_ENVIRONMENT_*).
const E = {
  GET_OVERSCAN: 2,
  GET_CAN_DUPE: 3,
  SET_MESSAGE: 6,
  SHUTDOWN: 7,
  SET_PERFORMANCE_LEVEL: 8,
  GET_SYSTEM_DIRECTORY: 9,
  SET_PIXEL_FORMAT: 10,
  SET_INPUT_DESCRIPTORS: 11,
  SET_DISK_CONTROL_INTERFACE: 13,
  GET_VARIABLE: 15,
  SET_VARIABLES: 16,
  GET_VARIABLE_UPDATE: 17,
  SET_SUPPORT_NO_GAME: 18,
  GET_LIBRETRO_PATH: 19,
  SET_FRAME_TIME_CALLBACK: 21,
  SET_AUDIO_CALLBACK: 22,
  GET_RUMBLE_INTERFACE: 23,
  GET_INPUT_DEVICE_CAPABILITIES: 24,
  GET_LOG_INTERFACE: 27,
  GET_PERF_INTERFACE: 28,
  GET_CONTENT_DIRECTORY: 30,
  GET_SAVE_DIRECTORY: 31,
  SET_SUBSYSTEM_INFO: 34,
  SET_CONTROLLER_INFO: 35,
  SET_MEMORY_MAPS: 36,
  SET_GEOMETRY: 37,
  GET_USERNAME: 38,
  GET_LANGUAGE: 39,
  SET_SUPPORT_ACHIEVEMENTS: 42,
  SET_SERIALIZATION_QUIRKS: 44,
  GET_LED_INTERFACE: 46,
  GET_AUDIO_VIDEO_ENABLE: 47,
  GET_FASTFORWARDING: 49,
  GET_TARGET_REFRESH_RATE: 50,
  GET_INPUT_BITMASKS: 51,
  GET_CORE_OPTIONS_VERSION: 52,
  SET_CORE_OPTIONS: 53,
  SET_CORE_OPTIONS_INTL: 54,
  SET_CORE_OPTIONS_DISPLAY: 55,
  GET_MESSAGE_INTERFACE_VERSION: 59,
  SET_MESSAGE_EXT: 60,
  GET_INPUT_MAX_USERS: 61,
  SET_AUDIO_BUFFER_STATUS_CALLBACK: 62,
  SET_MINIMUM_AUDIO_LATENCY: 63,
  SET_CORE_OPTIONS_V2: 67,
  SET_CORE_OPTIONS_V2_INTL: 68,
  SET_CORE_OPTIONS_UPDATE_DISPLAY_CALLBACK: 69,
  SET_VARIABLE: 70,
};

function handleEnv(mod: EmscriptenModule, state: CallbackState, rawCmd: number, dataPtr: number): boolean {
  const cmd = rawCmd & ~RETRO_ENVIRONMENT_EXPERIMENTAL;

  switch (cmd) {
    case E.GET_CAN_DUPE:
      mod.setValue(dataPtr, 1, "i8");
      return true;

    case E.GET_OVERSCAN:
      mod.setValue(dataPtr, 0, "i8");
      return true;

    case E.SET_MESSAGE:
    case E.SET_MESSAGE_EXT:
      return true;

    case E.SET_PIXEL_FORMAT: {
      const fmt = mod.getValue(dataPtr, "i32");
      if (fmt === RETRO_PIXEL_FORMAT_XRGB8888 || fmt === RETRO_PIXEL_FORMAT_RGB565 || fmt === RETRO_PIXEL_FORMAT_0RGB1555) {
        state.pixelFormat = fmt;
        return true;
      }
      return false;
    }

    case E.SET_SUPPORT_NO_GAME:
      return true;

    case E.GET_SYSTEM_DIRECTORY:
      mod.setValue(dataPtr, allocString(mod, state.systemDir), "i32");
      return true;

    case E.GET_SAVE_DIRECTORY:
    case E.GET_CONTENT_DIRECTORY:
      mod.setValue(dataPtr, allocString(mod, state.saveDir), "i32");
      return true;

    case E.GET_LIBRETRO_PATH:
      mod.setValue(dataPtr, allocString(mod, state.systemDir), "i32");
      return true;

    case E.GET_LOG_INTERFACE: {
      const logCb = mod.addFunction((level: number, fmtPtr: number) => {
        let msg = "<unreadable>";
        try {
          msg = mod.UTF8ToString(fmtPtr);
        } catch {
          /* varargs — не декодируем, сама fmt-строка обычно уже читаема */
        }
        if (level >= 3) console.error("[genesis_plus_gx]", msg);
      }, "viii");
      mod.setValue(dataPtr, logCb, "i32");
      return true;
    }

    case E.SET_VARIABLES: {
      let ptr = dataPtr;
      for (;;) {
        const keyPtr = mod.getValue(ptr, "i32");
        const descPtr = mod.getValue(ptr + 4, "i32");
        if (keyPtr === 0) break;
        const key = mod.UTF8ToString(keyPtr);
        const desc = descPtr ? mod.UTF8ToString(descPtr) : "";
        const semi = desc.indexOf("; ");
        if (semi >= 0) {
          const options = desc.substring(semi + 2).split("|");
          const prior = state.coreVariables.get(key);
          state.coreVariables.set(key, { value: prior && options.includes(prior.value) ? prior.value : options[0] });
        }
        ptr += 8;
      }
      return true;
    }

    case E.SET_CORE_OPTIONS:
    case E.SET_CORE_OPTIONS_INTL:
    case E.SET_CORE_OPTIONS_V2:
    case E.SET_CORE_OPTIONS_V2_INTL:
      return true;

    case E.GET_VARIABLE: {
      const keyPtr = mod.getValue(dataPtr, "i32");
      if (keyPtr === 0) return false;
      const key = mod.UTF8ToString(keyPtr);
      const v = state.coreVariables.get(key);
      if (!v) {
        mod.setValue(dataPtr + 4, 0, "i32");
        return false;
      }
      mod.setValue(dataPtr + 4, allocString(mod, v.value), "i32");
      return true;
    }

    case E.GET_VARIABLE_UPDATE:
      mod.setValue(dataPtr, state.variablesUpdated ? 1 : 0, "i8");
      state.variablesUpdated = false;
      return true;

    case E.GET_CORE_OPTIONS_VERSION:
      mod.setValue(dataPtr, 0, "i32");
      return true;

    case E.GET_LANGUAGE:
      mod.setValue(dataPtr, 0, "i32"); // English
      return true;

    case E.GET_USERNAME:
      mod.setValue(dataPtr, allocString(mod, "player"), "i32");
      return true;

    case E.GET_INPUT_DEVICE_CAPABILITIES:
      mod.setValue(dataPtr, 1 << RETRO_DEVICE_JOYPAD, "i32");
      return true;

    case E.GET_INPUT_BITMASKS:
      return true;

    case E.GET_AUDIO_VIDEO_ENABLE:
      mod.setValue(dataPtr, 7, "i32"); // audio + video + fast savestates
      return true;

    case E.GET_FASTFORWARDING:
      mod.setValue(dataPtr, 0, "i8");
      return true;

    case E.GET_TARGET_REFRESH_RATE:
      mod.setValue(dataPtr, 60.0, "double");
      return true;

    case E.GET_INPUT_MAX_USERS:
      mod.setValue(dataPtr, 2, "i32");
      return true;

    case E.GET_MESSAGE_INTERFACE_VERSION:
      mod.setValue(dataPtr, 0, "i32");
      return true;

    case E.SHUTDOWN:
      return true;

    // Принимаем и игнорируем — используем дефолты ядра.
    case E.SET_INPUT_DESCRIPTORS:
    case E.SET_CONTROLLER_INFO:
    case E.SET_SUBSYSTEM_INFO:
    case E.SET_MEMORY_MAPS:
    case E.SET_PERFORMANCE_LEVEL:
    case E.SET_GEOMETRY:
    case E.SET_FRAME_TIME_CALLBACK:
    case E.SET_AUDIO_CALLBACK:
    case E.SET_AUDIO_BUFFER_STATUS_CALLBACK:
    case E.SET_MINIMUM_AUDIO_LATENCY:
    case E.SET_DISK_CONTROL_INTERFACE:
    case E.SET_SUPPORT_ACHIEVEMENTS:
    case E.SET_SERIALIZATION_QUIRKS:
    case E.SET_CORE_OPTIONS_DISPLAY:
    case E.SET_CORE_OPTIONS_UPDATE_DISPLAY_CALLBACK:
    case E.SET_VARIABLE:
      return true;

    // Не поддерживаем — ядро уходит на фоллбэк.
    case E.GET_RUMBLE_INTERFACE:
    case E.GET_PERF_INTERFACE:
    case E.GET_LED_INTERFACE:
      return false;

    default:
      return false;
  }
}
