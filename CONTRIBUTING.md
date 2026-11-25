# Contributing to Utter

Thanks for helping. Utter is a small, friendly project: free, open source (MIT), and built to be easy to read.

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Report security issues privately, see [SECURITY.md](SECURITY.md).

## Ground rules

These are the product's promises. Pull requests that break them will not be merged.

- Audio never leaves the PC.
- No telemetry or analytics of any kind.
- Dictation is never lost: any Claude failure falls back to local cleanup.
- The API key lives only in Windows Credential Manager, never in settings, logs or errors.
- Branding: the text "Powered by Claude Haiku" only. No Anthropic or other companies' logos or copy. See [brand/BRAND.md](brand/BRAND.md) for voice and visuals.

## Getting set up

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for prerequisites (Rust, Node, CMake, LLVM, MSVC) and platform notes, and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the code is organized.

```
cd apps/desktop
npm install
npm run tauri dev
```

The UI also runs in a plain browser with a mock backend (`npm run dev`), which is the quickest way to work on screens.

## Before you open a pull request

From `apps/desktop`:

```
npm run typecheck
npm run lint
npm test
```

From `apps/desktop/src-tauri` (PowerShell, not Git Bash):

```
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test --lib
```

CI runs the same checks on Windows.

## Code guidelines

- **Pure logic gets unit tests first.** Text rules, snippets, dictionary, styles, the classifier, prompt builders, the hotkey matcher and stats math are pure modules. Write the test, then the code.
- **Windows-specific code** goes in `*_windows.rs` files or `cfg(target_os = "windows")` modules behind a small platform-neutral function, so macOS can be added later.
- TypeScript is strict. Keep the types in `apps/desktop/src/lib/types.ts` in sync with the Rust IPC types (camelCase).
- Follow the brand tokens and fonts in the UI; don't add new colours ad hoc.
- Keep changes focused. Small pull requests get reviewed faster.

## Commit and PR style

- Short imperative commit subjects, with a prefix when it helps: `feat:`, `fix:`, `docs:`, `test:`, `chore:`.
- Fill in the pull request template. UI changes need a screenshot or short clip.
- Update [CHANGELOG.md](CHANGELOG.md) under "Unreleased" for user-visible changes.

## Reporting bugs and ideas

Use the issue templates. For questions or early ideas, start a Discussion. Never paste your API key or private dictated text.
