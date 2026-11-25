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

You can build natively for ARM64 (see below) or fall back to the x64 toolchain under emulation.

### Native ARM64 build

whisper.cpp's ggml refuses MSVC for ARM ("MSVC is not supported for ARM, use clang"), so the C/C++ parts are built with `clang-cl` through Ninja. The release workflow does the same for the `aarch64-pc-windows-msvc` leg.

1. Install the Visual Studio component "MSVC v143 - VS 2022 C++ ARM64/ARM64EC build tools" (it provides `VC\Tools\MSVC\<ver>\lib\arm64`). This needs admin rights. `--passive` only works from an elevated start, for example:

   ```powershell
   Start-Process -Verb RunAs -FilePath "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\setup.exe" `
     -ArgumentList 'modify --installPath "C:\Program Files\Microsoft Visual Studio\2022\<edition>" --add Microsoft.VisualStudio.Component.VC.Tools.ARM64 --passive'
   ```

2. Install LLVM (the Windows ARM64 "woa64" build) and Ninja, e.g. `winget install LLVM.LLVM` and `winget install Ninja-build.Ninja`.
3. Set the environment, then build with the default ARM64 toolchain:

   ```powershell
   $env:CMAKE_GENERATOR = "Ninja"
   $env:CC = "clang-cl"
   $env:CXX = "clang-cl"
   $env:CXXFLAGS = "/EHsc"   # clang-cl needs exceptions enabled explicitly
   $env:LIBCLANG_PATH = "C:\Program Files\LLVM\bin"
   $env:CARGO_TARGET_DIR = "C:\ut"   # short path, see Long paths
   cargo test --lib
   ```

### Alternative: x64 toolchain under emulation

If you would rather not install the ARM64 component, build with the x64 toolchain, which runs under emulation:

```
rustup toolchain install stable-x86_64-pc-windows-msvc --profile minimal --force-non-host
cargo +stable-x86_64-pc-windows-msvc test --lib
```

The x64 toolchain loads an x64 `libclang.dll`: point `LIBCLANG_PATH` at an x64 LLVM `bin` directory (an ARM64 LLVM install fails with "invalid DLL (ARM64)").

## Benchmarks

Speech engine (`apps/desktop/src-tauri/examples/bench.rs`), `ten_seconds.wav` (11.6 s of synthetic speech from `scripts/make-test-audio.ps1`), greedy decoding, English, 4 threads, release build.

Machine: Snapdragon X (X1P64100, 10 cores) laptop, Windows 11 ARM64.

**Native ARM64** (release build, clang-cl, 4 threads):

| Model | Load | Transcribe (11.6 s clip) |
|---|---|---|
| `base` (`ggml-base.bin`, 148 MB) | 332-361 ms | 1297-1346 ms |
| `small-q5_1` (`ggml-small-q5_1.bin`, 190 MB) | 367-886 ms | 6101-6961 ms |

Six threads made `small-q5_1` slower (12.4 s) and eight was pathological, so the 4-thread cap stays.

**x64 build under emulation** (kept for comparison; pessimistic):

| Model | Load | Transcribe (11.6 s clip) |
|---|---|---|
| `base` | ~350-430 ms | 3.7-3.9 s (2 runs) |
| `small-q5_1` | ~420 ms | 14.0-15.0 s (2 runs) |

Rule: default is `small-q5_1` if its 10 s transcribe is <= 1500 ms, else `base`. `small-q5_1` is far over the bar even natively, so the default stays **`base`**.

Reproduce:

```
cd apps/desktop/src-tauri
cargo run --release --example bench -- "%APPDATA%\dev.utter.app\models\ggml-base.bin" tests\fixtures\ten_seconds.wav
```

Notes from the emulated run:

- Thread count matters enormously: with 6 or more threads whisper.cpp was 50x+ slower than with 4 (spin-wait contention under emulation). The engine therefore defaults to `min(cores, 4)` threads; set `UTTER_THREADS=<n>` to override while benchmarking.
- The release numbers above were measured with whisper-rs-sys built with extra CMake env vars (`CMAKE_C_FLAGS_RELEASE=CMAKE_CXX_FLAGS_RELEASE="/O2 /Ob2 /DNDEBUG /MD"`, `GGML_AVX=GGML_AVX2=GGML_FMA=GGML_F16C=ON`). They are probably unnecessary: the ignored `transcribe` test, built with the default flags in the debug profile (which uses `RelWithDebInfo`), transcribed `hello.wav` in 3.9 s total at 4 threads. The thread count was the real problem. Run `cargo clean -p whisper-rs-sys` after changing such variables.
- `tests/transcribe.rs` (ignored by default) needs `ggml-base.bin` downloaded: `cargo test --test transcribe -- --ignored`.

## Project layout

See [ARCHITECTURE.md](ARCHITECTURE.md) for the module map and dictation pipeline.

## Running the UI without Tauri

`npm run dev` in `apps/desktop` serves the UI in a browser with an in-memory mock backend (`src/lib/mock.ts`), which is the fastest way to iterate on screens.

## Checks (same as CI)

```
cd apps/desktop
npm run typecheck && npm run lint && npm test && npm run build

cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test --lib
```

`npm run build` must run before cargo, because Tauri embeds the built `dist`.

## Releases

Pushing a tag `v*` runs `.github/workflows/release.yml`, which builds unsigned NSIS installers for x64 and ARM64 (both cross-built on `windows-latest`) and attaches them to a **draft** GitHub Release. Bump the version in `apps/desktop/package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`, and update `CHANGELOG.md` first. The release job fails if the tag does not match the version in `tauri.conf.json`. CI and releases use a short `CARGO_TARGET_DIR` (`C:\t`) for the long-path issue above.

Utter is a Windows app: Rust commands that link the Tauri crate must run on Windows with MSVC and LLVM (see Prerequisites).
