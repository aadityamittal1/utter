# Utter — Design

> Speak anywhere. Utter writes it. Free, open source voice dictation for Windows (macOS next), with local speech recognition and Claude Haiku for cleanup.

Status: draft for approval · Date: 2026-11-24 · Owner: aadityamittal1

## 1. Intent and why

The owner wants a free, open source desktop dictation app that does what Wispr Flow does — and a little more — that anyone can install, connect to their own Claude account, and use all day. It must look and feel like a finished product (its own brand, onboarding, polish), and the repository must be a well-structured open source project people can contribute to.

Success looks like: a person downloads the installer, pastes an Anthropic API key, picks a microphone, holds a key, talks, and clean text appears in whatever app they were typing in, about a second after they let go. Voice shortcuts ("my linkedin" → their LinkedIn URL) and one-step AI rewriting (polish an email, turn rambling into a good AI prompt) work from the first day.

## 2. Decisions already made with the owner

| Decision | Choice | Why |
|---|---|---|
| How users connect Claude | **Their own Anthropic API key** (BYOK) | Anthropic's policy does not allow third-party products to offer claude.ai plan login or plan rate limits; routing through a user's Claude Code CLI was measured at ~25 s per call. Haiku 5.5 at $0.10 / $0.50 per MTok costs ≈ $0.0003 per dictation. |
| Speech-to-text | **Local Whisper (whisper.cpp)** on the user's machine | Claude does not accept audio input. Local is free, private, works offline. |
| App framework | **Tauri v2** (Rust core + React/TypeScript UI) | ~15 MB installers, proven by open source dictation apps (Handy), one codebase for Windows and macOS. Electron is ~10× larger and still needs native hooks; fully native means two codebases. |
| Brand | Designed from scratch by us (name, logo, palette, icons) | Owner delegated branding. Nothing copied from Wispr Flow. |
| Distribution | Public GitHub repo `aadityamittal1/utter`, MIT license, pushed directly to `main` | Owner asked for free, open source, push to main. |
| Platforms | **Windows only for v1** (x64 + ARM64). macOS is the next milestone. | Owner: "no need to do the mac build right now, let's finish with Windows." Platform-specific code sits behind `cfg(target_os)` modules so macOS can be added. macOS shortcuts named in this doc are for that milestone. |
| Name | **Utter** | Approved by owner. |

## 3. Goals (v1)

Desktop feature parity with Wispr Flow's dictation product, mapped to our names:

### 3.1 Dictation
- **Push-to-talk**: hold the dictation shortcut, speak, release → text is inserted into the focused app. Defaults: Windows `Ctrl+Win`, macOS `Ctrl+Option` (Fn is not reliably capturable; user can rebind).
- **Hands-free**: double-tap the dictation shortcut within 400 ms, or press `Ctrl+Win+Space` / `Ctrl+Option+Space`, to lock recording on; press again (or click ■ on the pill) to finish.
- **Cancel**: `Esc` while recording, or the ✕ on the pill. Nothing is inserted.
- Recordings under 0.4 s are discarded. Max length 20 min with a warning at 19.
- **Insertion**: save clipboard → put text on clipboard → simulate paste (`Ctrl+V` / `Cmd+V`; `Shift+Insert` for terminals where `Ctrl+V` fails) → restore the original clipboard after a short delay. If insertion fails, the text stays on the clipboard and the pill says "Copied — press Ctrl+V".
- **Paste last** (`Alt+Shift+Z` / `Cmd+Ctrl+V`) re-inserts the most recent result; **Copy last** copies it.
- Text is inserted once, on release (no streaming partials into the target app).

### 3.2 The Pill (floating bar)
- Small capsule docked bottom-center of the active display, above the taskbar/Dock; never takes focus; click-through when idle.
- States: **idle** (tiny, low-opacity), **listening** (expands, live level bars from mic RMS, red recording dot, elapsed timer after 10 s), **locked** (hands-free; shows ■ and ✕), **thinking** (bars settle into a soft shimmer), **done** (brief check / "Inserted"), **error** (short message + "Retry" / "Open history").
- Short start/stop sounds (toggleable). Right-click menu: Hide for 1 hour, Open Utter, Settings.
- Can be hidden entirely in settings.

### 3.3 AI cleanup (Claude)
- Levels: **Off** (raw Whisper text + local rules), **Light** (default: remove fillers, fix punctuation/grammar, apply backtrack), **Medium** (also tighten wording).
- **Backtrack**: "coffee at 2, actually 3" → "Coffee at 3."; keeps genuine uses of "actually".
- **Spoken punctuation & structure**: "comma", "period", "question mark", "new line", "new paragraph", numbered lists from "one… two…".
- URLs, emails, file names, code identifiers keep exact casing/spacing.
- Dictionary words are honored exactly.
- **Offline / no key / API error**: fall back to Off-level output (local deterministic cleanup) so dictation never blocks on the network. Pill notes "Inserted without AI cleanup".

### 3.4 Context awareness
- Read the foreground app's process name and window title at the start of a dictation.
- Classify into **Email, Work chat, Personal chat, AI prompt, Code, Document, Other** using a built-in, user-editable rules table (process names + window-title/domain keywords, e.g. "Gmail", "Outlook", "Slack", "ChatGPT", "Claude", "Code.exe").
- Category drives Style and the "Enhance" behavior. App name is sent to Claude as context. Toggle in Privacy settings. No screenshots, no reading other fields.

### 3.5 Styles
Per category: **Formal** (full caps + punctuation), **Casual** (caps, lighter punctuation, no final period), **Very casual** (lowercase, minimal punctuation; Personal chat only), **Excited** (more exclamation; not for Personal). Defaults: Email = Formal, Work chat = Casual, Personal chat = Casual, AI prompt = Formal, Code = Formal, Document = Formal, Other = Formal.

### 3.6 Dictionary
- Words/names/jargon (≤ 60 chars) and **replacements** ("clawed" → "Claude").
- Words are fed to Whisper as an initial prompt (vocabulary bias) and to Claude as must-keep spellings. Replacements are applied deterministically after cleanup (case-insensitive, word-boundary).
- **Auto-learn**: when the user edits a result in History, words that changed are suggested as dictionary entries (one click to accept). Optional "Add to dictionary" from the pill's last-result menu.
- Import/export CSV.

### 3.7 Snippets (voice shortcuts)
- Trigger phrase (≤ 60 chars) → expansion (≤ 4,000 chars). Example: "my linkedin" → `https://linkedin.com/in/…`.
- Matching: case-insensitive, punctuation-insensitive, whole words, longest trigger wins.
- If the whole utterance is a trigger, insert the expansion directly — no AI call (instant).
- Inside a sentence, triggers are replaced with placeholders before Claude sees the text and expanded after, so Claude never rewrites them.
- Import/export CSV.

### 3.8 Enhance with AI (the owner's "AI fixing" ask)
Three ways, all using the same connected model:
1. **Dictate & enhance** shortcut (default `Ctrl+Win+Shift` / `Ctrl+Option+Shift`, hold-to-talk): dictation is not just cleaned but rewritten for the context — Email → a well-structured email; AI prompt → a clear, structured prompt (goal, context, constraints, output format); Work/Personal chat → a polished message; Other → clear prose.
2. **Auto-enhance per category**: setting to always enhance in chosen categories (e.g. always prompt-engineer in AI apps).
3. **Transforms on selected text**: select any text, press a transform shortcut, the selection is replaced. Built-ins: **Polish** (`Alt+Shift+1`), **Prompt engineer** (`Alt+Shift+2`). Users can create up to 8 custom transforms (name, instruction, shortcut). Undo is the app's own `Ctrl+Z`.

### 3.9 Command mode
- Hold `Ctrl+Win+Alt` / `Ctrl+Option+Cmd`, speak an instruction, release.
- With a selection (captured via simulated copy, clipboard restored): the instruction is applied to the selection and the result replaces it ("make this shorter", "translate to Spanish", "turn into bullets").
- Without a selection: the result is inserted at the cursor ("write a reply saying I can do Thursday").
- On by default (no paywall). `Esc` cancels.

### 3.10 Hub (main window)
Sidebar: **Home, History, Dictionary, Snippets, Styles, Transforms, Notes, Insights, Settings**.
- **Home**: greeting with the user's shortcut, quick stats (words this week, WPM, streak), recent activity, tips.
- **History**: grouped by day; each item shows final text, app, category; actions: copy, insert again, retry cleanup, show original (raw Whisper text) with diff, play audio, edit (feeds auto-learn), delete. Search.
- **Notes**: simple multi-note scratchpad; dictation into it works like any app. Quick-open shortcut `Alt+Shift+N`.
- **Insights**: total words, words this week, average WPM (words ÷ speaking time), time saved vs. 40 WPM typing, current/longest streak, 7-day × 24-hour activity heatmap, top apps and categories.
- **Settings**: Shortcuts (rebind every action, conflict detection, reset), Microphone (device list, live level test), Language (auto-detect or fixed; translate-to-English toggle), Speech model (list, download with progress, delete, active model), AI (API key — stored in OS keychain, test button, model picker: Haiku 5.5 default, Sonnet 5.5 optional; cleanup level; monthly cost estimate from token usage), Sounds, Pill visibility, Launch at login, Theme (system/light/dark), Privacy (history retention: forever / 24 h / never; keep audio 14 days on/off; context awareness on/off), About (version, licenses, GitHub link).

### 3.11 Onboarding (first run)
1. Welcome (brand, one-line pitch, privacy promise).
2. Connect Claude: paste API key → live validation call → "Connected". Link to console.anthropic.com. "Skip — use without AI" allowed.
3. Microphone: OS permission prompt (macOS mic + Accessibility explained with screenshots), device picker, live meter.
4. Speech model: recommended model auto-selected for the hardware, download with progress (can continue onboarding while it downloads).
5. Learn the shortcut: press it, see the key light up.
6. Try it: practice fields — an email and an AI prompt — show raw vs. cleaned, then Dictate & enhance.
7. Personalize: name, LinkedIn/email/website quick-add as snippets (directly serves the owner's example), pick styles.
8. Done → Hub opens; tray icon explained.

### 3.12 System
- Tray / menu-bar icon with: Open Utter, Start dictation, Paste last, Pause Utter (1 h), Settings, Quit.
- Launch at login (default on after onboarding), single instance, light/dark/system themes, keyboard accessible UI.
- Multilingual: Whisper's ~99 languages, auto-detect or fixed; optional translate-to-English.
- Quiet speech ("whisper mode"): automatic gain normalization before recognition.

## 4. Non-goals (v1)
- Mobile apps (iOS/Android) — separate project.
- Meeting recorder/notetaker, calendar, MCP server — separate product surface.
- Accounts, cloud sync, teams, billing — the app is local-only and free.
- Screenshot-based context, IDE file tagging, reading text around the cursor.
- macOS build: permissions flow, NSPanel pill, CGEventTap, Metal (next milestone).
- Linux packaging (code should stay portable; not tested/shipped).
- Auto-updater and code signing (need secrets/certificates the owner must create; documented as follow-up).

## 5. Anti-goals (failure even if it "works")
- Audio leaving the machine. Only text goes to Claude, and only when a key is set.
- Telemetry or analytics of any kind.
- Dictation blocked or lost because the network/API failed.
- Stealing focus or flashing windows when dictating.
- Any branding, copy, or art lifted from Wispr Flow or Anthropic (no Claude logo; "Powered by Claude Haiku" text only).
- Storing the API key in plain text.

## 6. Constraints
- Owner's dev machine: Windows 11 on **ARM64** (Snapdragon X, 16 GB, Adreno GPU), VS 2022 Build Tools present (MSVC 14.42, ARM64 host). Rust, CMake, LLVM must be installed.
- Release targets: Windows x64 + ARM64 (NSIS installer, unsigned). Built in GitHub Actions on tags.
- Claude API via raw HTTPS from Rust (`reqwest`) — there is no official Rust SDK. Header `anthropic-version: 2026-10-21`; no `temperature`/`top_p`/`top_k`. Model `claude-haiku-5-5`; thinking disabled for cleanup (latency), adaptive for Command mode/Enhance at low effort. Check `stop_reason` (`refusal`, `max_tokens`) before using output; on any failure fall back to local cleanup.
- Latency budget for a 10 s utterance on the owner's machine: recognition ≤ 1.0 s, Claude ≤ 1.0 s, insert ≤ 0.2 s. *(Our call: these are targets, not gates. The first implementation task is a benchmark on the owner's laptop; the default model is whichever of `small-q5_1` / `base` meets ~1.5 s for 10 s of audio, and onboarding auto-recommends by measured speed. A GPU (Vulkan) path is a follow-up, not v1.)*
- Verification without a human at the mic: pipeline tests feed pre-recorded/synthesized speech WAVs (Windows TTS) through recognition → cleanup → insertion into Notepad; the owner does a short live check at the end.

## 7. Approaches considered
| Approach | Trade-offs | Verdict |
|---|---|---|
| **Tauri v2 + whisper.cpp + Claude HTTPS** | Small, fast, one codebase; needs Rust/C++ toolchain | **Chosen** |
| Electron + Node + official TS SDK | Easier JS-only work, official SDK; 150 MB installs, still needs native key hooks and a native Whisper | Rejected |
| Native Swift (Mac) + C# (Windows) | Best OS integration; two full codebases | Rejected |
| Route Claude through user's Claude Code plan | Uses subscription; 25 s latency, against Anthropic's third-party policy | Rejected (owner chose API key) |

## 8. Architecture

```
utter/
├─ apps/desktop/                  Tauri app
│  ├─ src-tauri/                  Rust core
│  │  └─ src/
│  │     ├─ main.rs / lib.rs      app setup, plugins, tray, windows
│  │     ├─ hotkeys/              global key hook (down/up), chord matching, double-tap
│  │     ├─ audio/                cpal capture, resample 16 kHz mono, RMS levels, gain normalize, WAV save
│  │     ├─ stt/                  whisper engine wrapper, model registry + downloader (sha256)
│  │     ├─ llm/                  Anthropic client, prompts (cleanup / enhance / command / transform)
│  │     ├─ text/                 local cleanup rules, snippets, dictionary replacements, styles  ← pure, unit-tested
│  │     ├─ context/              foreground app + category classifier                           ← classifier pure, tested
│  │     ├─ insert/               clipboard save/restore, paste simulation, selection capture
│  │     ├─ pipeline.rs           orchestrates a dictation session state machine
│  │     ├─ store/                SQLite (history, dictionary, snippets, notes, transforms, stats), settings
│  │     └─ secrets.rs            OS keychain (keyring)
│  └─ src/                        React + TS UI (Vite)
│     ├─ windows/hub/             main window pages
│     ├─ windows/pill/            overlay window
│     ├─ windows/onboarding/
│     ├─ components/ ui/          design-system components
│     └─ lib/                     typed IPC bindings, hooks
├─ brand/                         logo SVGs, icons, palette, guidelines (BRAND.md)
├─ docs/                          architecture, development, privacy, specs
├─ .github/                       CI, release workflow, issue/PR templates
├─ README.md LICENSE CONTRIBUTING.md CODE_OF_CONDUCT.md SECURITY.md CHANGELOG.md
```

### 8.1 Technology choices (from prior-art research: Handy, Whispering, OpenWhispr, VoiceInk)
| Concern | Choice | Notes / pitfalls designed around |
|---|---|---|
| Global hotkeys (down + up, modifier-only chords) | `handy-keys` 0.3.x (low-level hook on Windows, CGEventTap on macOS); fallback `tauri-plugin-global-shortcut` (Pressed/Released, needs a non-modifier key) | Modifier-only chords fire as part of larger chords → a chord activates only if no other key is pressed during the first 150 ms of the hold and is cancelled if another key joins. Hotkeys stored as layout-independent key codes. macOS Secure Event Input and Accessibility revocation: poll and fall back to the plugin path. |
| Audio | `cpal` + `rubato` (16 kHz mono f32) | Opening the mic lazily loses the first word → 300 ms pre-roll ring buffer and optional "keep microphone warm". RMS levels emitted to the pill at ~30 fps. |
| Speech-to-text | `whisper-rs` 0.16 (whisper.cpp) with GGML models from `huggingface.co/ggerganov/whisper.cpp`, sha256-pinned | Default model chosen by hardware: `small-q5_1` (190 MB, multilingual). Options: `base` (148 MB, fastest), `large-v3-turbo-q5_0` (574 MB, most accurate). CPU everywhere in v1 + Metal on Apple Silicon; x64 builds without `-march=native` so old CPUs don't crash. Resumable `.part` download → verify → rename. |
| Insert / paste | `enigo` 0.6 + `tauri-plugin-clipboard-manager` | Clipboard-restore race: paste is serialized; restore happens ≥ 300 ms later on a background thread and is skipped if the clipboard changed meanwhile. Terminals (Windows Terminal, conhost, PowerShell, WezTerm, Alacritty, VS Code terminal-focused not detectable → Ctrl+V works there) use `Ctrl+Shift+V`. |
| Selected text (Command mode, Transforms) | Save clipboard → simulate copy → wait for clipboard change (Windows `GetClipboardSequenceNumber`, macOS change count) up to 400 ms → read → restore | No selection = no change within timeout. |
| Foreground app | `x-win` or `active-win-pos-rs` | Captured at recording start; target window re-focused before paste if focus moved to our own windows. |
| Pill window | Tauri `WebviewWindow`: no decorations, transparent, always-on-top, skip taskbar, `focusable(false)`; Windows `SetWindowPos(HWND_TOPMOST, SWP_NOACTIVATE)`; macOS `tauri-nspanel` non-activating panel | Bottom-center of the monitor under the cursor; physical-pixel math for DPI scaling. |
| Storage | `rusqlite` (bundled) + migrations for history/dictionary/snippets/notes/transforms/stats; `tauri-plugin-store` JSON for settings | |
| Secrets | `keyring` 4.x (Windows Credential Manager / macOS Keychain) | Never written to settings or logs. |
| Other plugins | `tauri-plugin-autostart`, `-single-instance`, `-opener`, `-dialog`, `-log`; `tauri-plugin-macos-permissions` | Updater deferred (needs signing key). |
| UI | React 19 + TypeScript (strict) + Vite + Tailwind CSS 4 + Zustand; Lucide icons | Two webview entries: hub (incl. onboarding) and pill. |

Known risk accepted for v1: unsigned binaries trigger SmartScreen / Gatekeeper warnings and, because of the keyboard hook + synthetic input, possible antivirus false positives. README documents it; signing is a follow-up.

Session pipeline (Rust, one at a time):
`Idle → Recording(mode) → Transcribing → Snippets/Dictionary pre-pass → Claude (cleanup | enhance | command) → Post-pass (expand snippets, replacements, style fallback) → Insert → Save history/stats → Idle`. Every stage emits events to the pill. Errors at Claude fall back; errors at recognition show Retry with saved audio.

## 9. Brand (our call)
- **Name: Utter** — "to speak". Tagline: *Speak anywhere. Utter writes it.*
- Mark: a rounded speech-bubble/pill whose left half is sound bars and right half is a text caret — voice becoming text. Works at 16 px as just the bars + caret.
- Palette (draft): Ink `#14131A`, Paper `#FAF8F5`, Ember (primary) `#FF5A36`, Ember dark `#E0401E`, Lilac accent `#8B7CF6`, neutrals warm grey scale; dark-mode equivalents.
- Type: Inter (UI), Instrument Serif or similar open-license display face for marketing headings; JetBrains Mono for code.
- Deliverables: logo mark + wordmark (light/dark, mono), app icons (all Tauri sizes, .ico, .icns), tray icons (Windows color + macOS template), pill visuals, README banner, GitHub social preview (1280×640), favicon, `brand/BRAND.md` usage guide.

## 10. Quality bar and verification
- Pure logic (text rules, snippets, dictionary, styles fallback, classifier, prompt builders, stats math, hotkey chord matcher) has unit tests (`cargo test`).
- UI: TypeScript strict, ESLint, Vitest for formatting/stats helpers.
- CI: fmt + clippy + tests + UI build on Windows for every push; release workflow builds Windows x64 + ARM64 installers on tags.
- Manual verification on the owner's machine: build and run, onboarding, dictate into Notepad/browser, snippets, enhance, command mode, transforms, history, insights.

## 11. Left to the builder
Exact crate versions, prompt wording, animation timings, sounds (generated, original), component library details, model download mirrors, and default rule lists — within the constraints above.
