# Utter UI v2: Windows-native design system, HeroUI, always-on-top pill

Status: approved by owner request ("get this done", 2026-11-26). Supersedes the visual sections of
`2026-11-24-utter-design.md`; behaviour and IPC contract stay as they are unless listed here.

Research inputs (not committed, summarised here): HeroUI v3 docs, Wispr Flow help center,
Handy overlay source, Microsoft Learn (Mica, title bar, Segoe UI Variable, Fluent 2), Chromium.

## 1. Direction (unslop)

- **Product.** A Windows dictation app: hold a shortcut, speak, and clean text lands wherever you were typing.
- **Character.** Quick, quiet, exact.
- **World.** A voice and a caret: the microphone, sound as a waveform, the blinking insertion point.
  Neutral graphite chrome so it sits beside every Windows app; the brand ember is the voice.
- **Moments.** (1) The pill's live waveform. (2) Home's "this week" figures and the Insights heatmap,
  set in large tabular Segoe UI Variable Display. Nothing else gets colour.
- **Signature.** Keycaps for every shortcut, and the five-bar waveform mark (from the logo) as the
  "live" indicator. Used only where something is listening or is a shortcut.

## 2. Design system

### Platform
- Windows 11 first. Hub window uses a **Mica** backdrop (`windowEffects: { effects: ["mica"] }`,
  `transparent: true`) with native decorations (lowest-risk; keeps Snap Layouts). If Mica can't be
  applied (Windows 10, transparency off) Rust sets `data-backdrop="solid"` on the hub and CSS paints an
  opaque `--bg`. With Mica, `html/body` are transparent; the sidebar sits on Mica and content sits on a
  "layer" surface with an 8px top-left radius, like Windows Settings.
- Theme: `system | light | dark` (existing setting). Apply both `data-theme` and `.dark|.light` class
  on `<html>` in **every** window (HeroUI keys on either). System follows `prefers-color-scheme`.
- Accent: new setting `accentSource: "utter" | "windows"` (default `utter` = ember). `windows` reads
  `UISettings.GetColorValue(Accent, AccentLight1..3, AccentDark1..3)` and listens to
  `ColorValuesChanged`; Rust emits `system://accent` `{ accent, light1, light2, light3, dark1, dark2, dark3 }`
  as `#rrggbb`. Frontend picks Light2 (dark theme) / Dark1 (light theme) for text-on-surface contrast.
- Text scaling: Rust reads `UISettings.TextScaleFactor` (1.0–2.25), emits `system://text-scale`; the
  hub sets `html { font-size: calc(100% * factor) }`. All type sizes in `rem`.
- Reduced motion: honour `prefers-reduced-motion` (Chromium maps it to the Windows animation setting)
  and set `data-reduce-motion` on `<html>` for HeroUI.
- Forced colors: every shadow-only edge keeps `border: 1px solid transparent`.

### Type (Segoe UI Variable, Windows type ramp)
- `--font-sans: "Segoe UI Variable Text", "Segoe UI Variable", "Segoe UI", system-ui, sans-serif`
- `--font-display: "Segoe UI Variable Display", "Segoe UI Variable", "Segoe UI", system-ui, sans-serif`
- `--font-mono: "Cascadia Mono", "Cascadia Code", Consolas, ui-monospace, monospace`
- Remove `@fontsource/*` (Inter, Instrument Serif, JetBrains Mono). No bundled fonts.
- Ramp (rem at 16px root), utilities named by role:

| Token | Size/line | Weight | Font |
| --- | --- | --- | --- |
| `text-caption` | 12/16 | 400 | sans |
| `text-body` | 14/20 | 400 | sans |
| `text-body-strong` | 14/20 | 600 | sans |
| `text-body-lg` | 18/24 | 400 | sans |
| `text-subtitle` | 20/28 | 600 | display |
| `text-title` | 28/36 | 600 | display, -0.01em |
| `text-title-lg` | 40/52 | 600 | display, -0.02em |
| `text-display` | 68/92 | 600 | display, -0.02em |

- No arbitrary `text-[..px]`. No uppercase tracked labels; overlines are sentence case `text-caption`
  muted. `tabular-nums` on every changing number. `…` not `...`. `antialiased` only on root.

### Colour (graphite ramp + one accent)
Light: bg `#f3f3f3` (Mica fallback), layer `#fbfbfb`, card `#ffffff`, raised `#f5f5f5`,
text `#1a1a1a`, secondary `#5c5c5c`, muted `#707070` (>=4.5:1 on card/layer), hairline `rgb(0 0 0 / 0.08)`.
Dark: bg `#202020` (Mica fallback), layer `#272727` (Mica: `rgb(255 255 255 / 0.04)`), card `#2c2c2c`,
raised `#333333`, text `#ffffff`, secondary `#c5c5c5`, muted `#9e9e9e`, hairline `rgb(255 255 255 / 0.08)`.
Accent ember: fill `#ff5a36` with dark text `#1a1a1a` (contrast ~5.8:1); as text on light `#c2361a`,
on dark `#ff8a6e`. Semantic: success `#0f7b0f`/`#6ccb5f`, danger `#c42b1c`/`#ff99a4`,
caution `#9d5d00`/`#fce100` (Fluent). The lilac `--highlight` colour is removed.
HeroUI variables (`--background --surface --overlay --default --border --separator --muted --accent
--accent-foreground --focus --field-*`) map onto these tokens in `:root` and `.dark,[data-theme=dark]`.

### Shape, depth, motion (Fluent)
- Radius: controls 4px (`--radius: 4px`, `--field-radius: 4px`), cards/layers/overlays 8px,
  pill capsule = half its height. Nested surfaces: outer = inner + padding.
- Depth: light `0 2px 4px rgb(0 0 0 / 0.04), 0 0 0 1px rgb(0 0 0 / 0.06)` for cards;
  flyouts `0 8px 16px rgb(0 0 0 / 0.14)`. Dark: surface steps + hairline only.
- Motion: one curve `cubic-bezier(0, 0, 0, 1)` (Windows entrance); 83ms fades, 167ms
  hover/press/toggle, 250ms menus, 333ms page enter. Exits 167ms `cubic-bezier(1, 0, 1, 1)`.
  Name transitioned properties; never `transition-all`; no `hover:scale`; no looping motion except
  things that are live (waveform, processing dots, spinners).
- Focus: Fluent two-tone ring, 2px outer `--text` + 1px inner `--card`, keyboard only.
- Spacing on the 4px grid; Fluent ramp 4/8/12/16/20/24/32/40/48.
- Controls 32px tall; nav rows 36px; content padding 32px; sidebar 248px.
- Icons: lucide only, 16px at stroke 1.5 next to 14px text, 20px at stroke 1.5 in nav.

### Components (HeroUI v3)
`@heroui/react` + `@heroui/styles` 3.x (+ react-aria peers). No provider; `<Toast.Provider>` once per
window that toasts. Our `components/ui/*` primitives become thin wrappers over HeroUI so pages keep
one import surface: Button/IconButton (HeroUI Button, `onPress`), Switch, TextField/Input/TextArea,
Select (HeroUI Select + ListBox), Modal (HeroUI Modal), Tabs, Tooltip (delay 300ms), Kbd, Card,
Chip, Toast (`toast()`), Slider, Spinner, ProgressBar/Meter, Dropdown. Native `<select>`, hand-rolled
modals/switches/toasts are removed. Wrappers keep `onClick` compatibility where tests rely on it, or
the tests move to `onPress` semantics.

## 3. Pill (always on top, pinned, waveform)

### Behaviour
- Pinned **bottom-centre of the monitor under the cursor**, 12px above that monitor's work area
  (so it clears the taskbar, auto-hide included). Follows the cursor's monitor while idle
  (re-checked every 500ms; moves only when the monitor changes). Recomputed on display/DPI/work-area change.
- **Always visible while idle** when `showPill` is on (Wispr-style resting bar), above every normal
  and topmost window. Hidden while a fullscreen app/game/presentation is in front
  (`SHQueryUserNotificationState` = D3D fullscreen / presentation / busy) unless dictating.
- Never takes focus: explicit `WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TOPMOST`,
  `WM_MOUSEACTIVATE -> MA_NOACTIVATE` (subclass), shown with `SWP_NOACTIVATE`.
- **Z-order keeper** (Rust thread): re-assert `HWND_TOPMOST` on `EVENT_SYSTEM_FOREGROUND`
  (SetWinEventHook, out-of-context), every 1500ms while visible, on display change, on resume/unlock.
- **Hover**: window stays click-through except over the visible capsule. A 60ms cursor poll while
  visible toggles `set_ignore_cursor_events` and emits `pill://hover {hover: bool}`.
- **Click idle pill** = start hands-free dictation (same as the HandsFree action). Click while
  listening (hold or hands-free) = stop and insert. Right-click = existing menu.

### Visuals (original design, not Wispr's)
- Window 360x72 logical, capsule centred at the bottom of it.
- Idle: 44x8 capsule, solid graphite `#1c1c1c` at 92% with a `rgb(255 255 255 / 0.18)` hairline,
  so it reads on light and dark wallpapers. Hover: grows to 196x32 and shows keycaps for the
  dictate shortcut + "to dictate" (from settings; falls back to "Click to dictate").
- Listening: 148x36, ember live dot, **waveform of 9 bars** (2px wide, 3px gap, 4–20px tall, white
  `#fff` at 92%, rounded), timer from 10s (tabular). Locked (hands-free): 212x36 adds stop (ember)
  and cancel buttons. Warning at 19 min shows "0:42 left" in caution.
- Thinking: bars collapse to a 3-dot pulse (live work; allowed). Done: check + "Inserted" 900ms.
  Error: danger-tinted capsule + message (+ Retry).
- Size changes animate width/height of the capsule by `transform`-free CSS (`width/height`
  transitions on an element this small are acceptable; 167ms Fluent curve), content fades 83ms.
- Reduced motion: bars show level as a single static meter (no RAF loop), no size animation.

### Waveform data
- Rust emits `pill://levels` (9 values 0..1) at ~30Hz while recording, computed from the last
  ~33ms of audio: RMS per slice -> dB, floor -55dB, ceiling -10dB, `pow(x, 0.7)`. Also a
  `mic://level` mean for the mic test (unchanged). Frontend: RAF lerp, attack 0.6 / release 0.2
  (existing `smoothLevels`), writes `transform: scaleY` only.

## 4. Pages (unslop passes, keep features and order)
- Shell: Mica sidebar (248px, nav rows 36px, icons 20px), content on the layer surface; product
  wordmark top-left; remove "Powered by Claude Haiku" footer (moves to About/AI settings).
- Home: title is "Home" with the date as caption — no greeting. Shortcut keycaps, three stat
  figures (label, figure, comparison "vs last week" only if real data exists), recent list, tip.
- History, Dictionary, Snippets, Styles, Transforms, Notes, Insights, Settings, Onboarding: same
  content; HeroUI controls; type ramp; sentence case; no exclamation marks; no trailing periods on
  labels; `…`; tabular numbers; one empty-state pattern; one chart accent.

## 5. Out of scope
Draggable/snap-to-edge pill (v1.1), custom title bar with in-bar content, macOS, code signing,
auto-update.

## 6. Verification
- `npm run typecheck && npm run lint && npm test && npm run build`; `cargo test --lib`,
  `cargo clippy --all-targets -- -D warnings`, `cargo fmt --check`.
- Browser screenshots of every page in light and dark (mock IPC) at 1100x720 and 900x600.
- Pill harness screenshots for every state.
- Real-window check on this machine: launch our own release build; verify pill ex-styles,
  `WS_EX_TOPMOST`, z-order above a normal topmost window we create, rect bottom-centre above the
  work area, click-through outside the capsule, and a waveform `pill://levels` stream while
  recording (log-level probe). The owner does the final hands-on run.
