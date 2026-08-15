fn main() {
    vendor_steam_api();
    tauri_build::build()
}

/// `steamworks-sys` copies `libsteam_api.so`/`.dll`/`.dylib` into its own
/// `OUT_DIR` but never next to the final binary, so Steam init fails at
/// runtime with a "library not found" error unless something copies it out.
/// Mirror it next to this crate's output dir (`target/<profile>/`, or
/// `target/<triple>/<profile>/` when cross-compiling) so both `cargo
/// run`/`tauri dev` and packaging (via `tauri.conf.json` `bundle.resources`,
/// which points at that same path) can pick it up.
fn vendor_steam_api() {
    use std::path::PathBuf;

    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap();
    let lib_name = match target_os.as_str() {
        "windows" => "steam_api64.dll",
        "macos" => "libsteam_api.dylib",
        _ => "libsteam_api.so",
    };

    let out_dir = PathBuf::from(std::env::var("OUT_DIR").unwrap());
    // OUT_DIR = target/<profile>/build/nes_launhder-<hash>/out
    let build_dir = out_dir
        .parent()
        .and_then(|p| p.parent())
        .expect("OUT_DIR has unexpected shape");
    let profile_dir = build_dir
        .parent()
        .expect("build/ dir has unexpected shape");

    let steamworks_out = std::fs::read_dir(build_dir)
        .expect("failed to read cargo build dir")
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with("steamworks-sys-")
        })
        .map(|entry| entry.path().join("out").join(lib_name))
        .filter(|path| path.is_file())
        .max_by_key(|path| {
            std::fs::metadata(path)
                .and_then(|m| m.modified())
                .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
        });

    if let Some(src) = steamworks_out {
        let dest = profile_dir.join(lib_name);
        std::fs::copy(&src, &dest).unwrap_or_else(|e| {
            panic!("failed to copy {} to {}: {e}", src.display(), dest.display())
        });
    }

    if target_os == "linux" {
        // Let the binary find libsteam_api.so sitting next to it, both in
        // the raw target dir (dev) and inside the packaged bundle, where
        // tauri.conf.json's bundle.resources places it in the same dir as
        // the executable.
        println!("cargo:rustc-link-arg-bins=-Wl,-rpath,$ORIGIN");
    }
}
