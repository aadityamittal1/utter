# Development

## Prerequisites (Windows)

- Rust stable (rustup), Node.js 20+, CMake, LLVM (for `whisper-rs` bindgen), MSVC Build Tools.
- Set `LIBCLANG_PATH` to LLVM's `bin` directory, e.g. `C:\Program Files\LLVM\bin`, and make sure CMake and LLVM `bin` are on `PATH`.
- Run Rust commands from PowerShell or a Developer prompt, not Git Bash: Git Bash puts GNU `link` ahead of MSVC `link.exe`.

## Commands

```
cd apps/desktop
npm install
npm run typecheck && npm run lint && npm test
npm run tauri dev

cd src-tauri
cargo test --lib
```

## Long paths

Cargo build scripts fail with `LNK1104` when the build directory path is very long. If your checkout lives deep in the filesystem, set a short target dir, e.g. `CARGO_TARGET_DIR=C:\ut`.

## Windows ARM64 dev machines

The MSVC "ARM64 build tools" component may be missing (check for `VCToolsMSVC<ver>libarm64`). Without it the `aarch64-pc-windows-msvc` target cannot link. Either install the component (Visual Studio Installer, Individual components, "MSVC v143 - VS 2022 C++ ARM64 build tools") or build with the x64 toolchain, which runs under emulation:

```
rustup toolchain install stable-x86_64-pc-windows-msvc --profile minimal --force-non-host
cargo +stable-x86_64-pc-windows-msvc test --lib
```

The x64 toolchain loads an x64 `libclang.dll`: point `LIBCLANG_PATH` at an x64 LLVM `bin` directory (an ARM64 LLVM install fails with "invalid DLL (ARM64)").

## Benchmarks

(Filled in by the speech engine task.)
