// Pure helpers for the pill: timer text, level smoothing, capsule geometry.
import { formatChord } from "../lib/format";
import type { PillAction, PillState } from "../lib/types";

export const BAR_COUNT = 9;
export const MAX_RECORDING_MS = 20 * 60_000;
export const WARNING_AT_MS = 19 * 60_000;
export const TIMER_SHOWS_AT_MS = 10_000;
export const DONE_VISIBLE_MS = 900;

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** m:ss, e.g. 12_000 -> "0:12", 61_000 -> "1:01". Negative or NaN -> "0:00". */
export function formatTimer(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export const showTimer = (elapsedMs: number): boolean => elapsedMs >= TIMER_SHOWS_AT_MS;
export const isWarning = (elapsedMs: number): boolean => elapsedMs >= WARNING_AT_MS;

/** Time left before the 20 minute cap, as "0:42 left". */
export function formatRemaining(elapsedMs: number): string {
  return `${formatTimer(Math.max(0, MAX_RECORDING_MS - elapsedMs))} left`;
}

/** Per-frame coefficient equivalent to coefficient k applied every 40 ms. */
export function frameCoef(k: number, dtMs: number): number {
  const dt = Number.isFinite(dtMs) ? Math.min(100, Math.max(0, dtMs)) : 40;
  return 1 - Math.pow(1 - k, dt / 40);
}

/** Fast attack, slower release, so bars jump with speech and settle calmly. The single smoothing stage. */
export function smoothLevels(prev: readonly number[], target: readonly number[], dtMs = 40, attack = 0.6, release = 0.2): number[] {
  const a = frameCoef(attack, dtMs);
  const r = frameCoef(release, dtMs);
  return Array.from({ length: BAR_COUNT }, (_, i) => {
    const p = clamp01(prev[i] ?? 0);
    const t = clamp01(target[i] ?? 0);
    const v = p + (t - p) * (t > p ? a : r);
    return v < 0.002 ? 0 : v;
  });
}

/** Taller in the middle so the bars read as a waveform, not a fence. */
export function envelope(i: number, n = BAR_COUNT): number {
  return 0.6 + 0.4 * Math.sin((Math.PI * (i + 0.5)) / n);
}

export const BAR_MIN_PX = 4;
export const BAR_MAX_PX = 20;

/** Level 0..1 -> bar height in px. Slight curve so quiet speech still moves. */
export function barHeight(level: number, i: number): number {
  const shaped = Math.pow(clamp01(level), 0.7) * envelope(i);
  return Math.round((BAR_MIN_PX + (BAR_MAX_PX - BAR_MIN_PX) * shaped) * 10) / 10;
}

/** Bar elements are BAR_MAX_PX tall and scaled with transform (no layout per frame). */
export function barScale(level: number, i: number): number {
  return Math.round((barHeight(level, i) / BAR_MAX_PX) * 1000) / 1000;
}

/** Timer shown: the backend value, but never behind a local clock anchored at the first listening event. */
export function effectiveElapsed(eventMs: number, localMs: number): number {
  return Math.max(Number.isFinite(eventMs) ? eventMs : 0, Number.isFinite(localMs) ? localMs : 0);
}

/** Fixed profile for prefers-reduced-motion. */
export function staticBarHeights(): number[] {
  return Array.from({ length: BAR_COUNT }, (_, i) => barHeight(0.35, i));
}

export type PillView = "idle" | "hover" | "listening" | "locked" | "thinking" | "done" | "error" | "warning" | "menu";

/** The visual a state maps to. The 19-minute warning replaces the timer; hover only affects idle. */
export function viewFor(s: PillState, menuOpen: boolean, hover = false): PillView {
  if (menuOpen) return "menu";
  if (s.state === "listening" && isWarning(s.elapsedMs)) return "warning";
  if (s.state === "idle" && hover) return "hover";
  return s.state;
}

export interface Size {
  w: number;
  h: number;
}

/**
 * Capsule size in logical px, bottom-centred in the 360x72 window. MUST mirror
 * `pill_capsule_rect` in src-tauri/src/windows.rs (a test parses that file). The menu is drawn
 * inside Rust's 340x40 menu hit rect.
 */
export const CAPSULE_SIZES = {
  idle: { w: 44, h: 8 },
  hover: { w: 196, h: 32 },
  listening: { w: 148, h: 36 },
  warning: { w: 148, h: 36 },
  locked: { w: 212, h: 36 },
  thinking: { w: 72, h: 36 },
  done: { w: 148, h: 36 },
  error: { w: 280, h: 36 },
  menu: { w: 336, h: 40 },
} as const satisfies Record<PillView, Size>;

export const WINDOW_SIZE: Size = { w: 360, h: 72 };
/** Gap between the capsule and the window's bottom edge (Rust CAPSULE_BOTTOM_MARGIN). */
export const CAPSULE_BOTTOM_MARGIN = 8;

export function capsuleSize(view: PillView): Size {
  return CAPSULE_SIZES[view];
}

/** Rust's menu_allowed: no menu during the brief thinking / done flashes. */
export function menuAllowed(s: PillState): boolean {
  return s.state !== "thinking" && s.state !== "done";
}

/** Longest chord (in characters) that still fits the 196 px hover capsule next to "to dictate". */
const HOVER_MAX_KEYS = 3;
const HOVER_MAX_CHARS = 13;

/** Keys to show as keycaps in the hover capsule, or null to fall back to "Click to dictate". */
export function hoverKeys(chord: string | undefined): string[] | null {
  const keys = formatChord(chord);
  if (keys.length === 0 || keys.length > HOVER_MAX_KEYS) return null;
  if (keys.join("").length > HOVER_MAX_CHARS) return null;
  return keys;
}

/**
 * What a click on the capsule body does: start from idle, stop-and-insert while live,
 * nothing otherwise (thinking, done, error, menu).
 */
export function clickAction(view: PillView): PillAction | null {
  switch (view) {
    case "idle":
    case "hover":
      return "start";
    case "listening":
    case "warning":
    case "locked":
      return "toggle";
    default:
      return null;
  }
}

/** Screen-reader label for the live region. */
export function ariaLabel(s: PillState): string {
  switch (s.state) {
    case "idle":
      return "Utter is ready";
    case "listening":
      return "Listening";
    case "locked":
      return "Listening, hands-free";
    case "thinking":
      return "Working on it";
    case "done":
      return s.message ?? "Inserted";
    case "error":
      return s.message ?? "Something went wrong";
  }
}
