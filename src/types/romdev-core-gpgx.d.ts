// romdev-core-gpgx не поставляет типы (это бинарный пакет — обёртка над
// genesis_plus_gx_libretro.js/.wasm, см. src/emulator/genesis/GenesisCore.ts).
declare module "romdev-core-gpgx/wasm/genesis_plus_gx_libretro.js" {
  import type { EmscriptenModule } from "../emulator/genesis/callbacks";
  const create: (opts: Record<string, unknown>) => Promise<EmscriptenModule>;
  export default create;
}
