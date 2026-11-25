// Pure helpers for the pill: timer text, level smoothing, capsule geometry.
import type { PillState } from "../lib/types";

export const BAR_COUNT = 12;
export const MAX_RECORDING_MS = 20 * 60_000;
export const WARNING_AT_MS = 19 * 60_000;
export const TIMER_SHOWS_AT_MS = 10_000;
export const DONE_VISIBLE_MS = 900;

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

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

/** Fast attack, slower release, so bars jump with speech and settle calmly. */
export function smoothLevels(prev: readonly number[], target: readonly number[], attack = 0.6, release = 0.2): number[] {
  return Array.from({ length: BAR_COUNT }, (_, i) => {
    const p = clamp01(prev[i] ?? 0);
    const t = clamp01(target[i] ?? 0);
    const k = t > p ? attack : release;
    const v = p + (t - p) * k;
    return v < 0.002 ? 0 : v;
  });
}

/** Taller in the middle so the bars read as a waveform, not a fence. */
export function envelope(i: number, n = BAR_COUNT): number {
  return 0.6 + 0.4 * Math.sin((Math.PI * (i + 0.5)) / n);
}

export const BAR_MIN_PX = 3;
export const BAR_MAX_PX = 22;

/** Level 0..1 -> bar height in px. Slight curve so quiet speech still moves. */
export function barHeight(level: number, i: number): number {
  const shaped = Math.pow(clamp01(level), 0.7) * envelope(i);
  return Math.round((BAR_MIN_PX + (BAR_MAX_PX - BAR_MIN_PX) * shaped) * 10) / 10;
}

/** Fixed profile for prefers-reduced-motion. */
export function staticBarHeights(): number[] {
  return Array.from({ length: BAR_COUNT }, (_, i) => barHeight(0.35, i));
}

export type PillView = "idle" | "listening" | "locked" | "thinking" | "done" | "error" | "warning" | "menu";

/** The visual a state maps to. The 19-minute warning replaces the timer. */
export function viewFor(s: PillState, menuOpen: boolean): PillView {
  if (menuOpen) return "menu";
  if (s.state === "listening" && isWarning(s.elapsedMs)) return "warning";
  return s.state;
}

export interface Size {
  w: number;
  h: number;
}

const CHAR_PX = 6.4;

/** Capsule size in logical px. The window is 360x72, so everything stays <= 340 wide. */
export function capsuleSize(view: PillView, message?: string): Size {
  switch (view) {
    case "idle":
      return { w: 40, h: 8 };
    case "listening":
      return { w: 200, h: 40 };
    case "warning":
      return { w: 236, h: 40 };
    case "locked":
      return { w: 252, h: 40 };
    case "thinking":
      return { w: 92, h: 40 };
    case "done": {
      const len = (message ?? "Inserted").length;
      return { w: clamp(Math.round(68 + len * CHAR_PX), 128, 260), h: 40 };
    }
    case "error": {
      const len = (message ?? "Something went wrong").length;
      return { w: clamp(Math.round(112 + len * CHAR_PX), 200, 340), h: 40 };
    }
    case "menu":
      return { w: 336, h: 40 };
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
