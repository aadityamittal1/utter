// Runtime appearance: theme, Windows accent, text scale, reduced motion, backdrop.
// Pure resolvers are exported for tests; applyAppearance() writes them onto <html>
// and is safe to call in every window (hub and pill).

import type { AccentSource, BackdropKind, SystemAccent, ThemePref } from "./types";

export type { SystemAccent } from "./types";
export type ResolvedTheme = "light" | "dark";

export const THEME_KEY = "utter.theme";
export const ACCENT_SOURCE_KEY = "utter.accentSource";
export const TEXT_SCALE_KEY = "utter.textScale";
export const ACCENT_KEY = "utter.accent";
const MIN_TEXT_SCALE = 1;
const MAX_TEXT_SCALE = 2.25;
const INK = "#1a1814";

export function resolveTheme(pref: ThemePref, systemDark: boolean): ResolvedTheme {
  if (pref === "system") return systemDark ? "dark" : "light";
  return pref;
}

/** Windows reports 1.0 to 2.25; anything else is ignored. */
export function clampTextScale(factor: number | undefined): number {
  if (typeof factor !== "number" || !Number.isFinite(factor)) return 1;
  return Math.min(MAX_TEXT_SCALE, Math.max(MIN_TEXT_SCALE, factor));
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** Text colour (ink or white) with the better contrast on the given fill. */
export function pickOnColor(fill: string): string {
  const l = luminance(fill);
  const vsInk = (l + 0.05) / (luminance(INK) + 0.05);
  const vsWhite = 1.05 / (l + 0.05);
  return vsInk >= vsWhite ? INK : "#ffffff";
}

/** CSS variables that recolour the accent roles, or null when Utter's own ember applies. */
export function accentVars(source: AccentSource, accent: SystemAccent | null, theme: ResolvedTheme): Record<string, string> | null {
  if (source !== "windows" || !accent) return null;
  const text = theme === "dark" ? accent.light2 : accent.dark1;
  return {
    "--ember": accent.accent,
    "--accent-fill": accent.accent,
    "--accent-fill-hover": theme === "dark" ? accent.light1 : accent.dark1,
    "--ember-text": text,
    "--ember-soft": `color-mix(in srgb, ${accent.accent} ${theme === "dark" ? 16 : 12}%, transparent)`,
    "--on-ember": pickOnColor(accent.accent),
    "--accent-system": accent.accent,
    "--accent-light1": accent.light1,
    "--accent-light2": accent.light2,
    "--accent-light3": accent.light3,
    "--accent-dark1": accent.dark1,
    "--accent-dark2": accent.dark2,
    "--accent-dark3": accent.dark3,
  };
}

// ---- DOM side ------------------------------------------------------------

interface State {
  theme: ThemePref;
  accentSource: AccentSource;
  accent: SystemAccent | null;
  textScale: number;
  backdrop: BackdropKind;
}

const state: State = { theme: "system", accentSource: "utter", accent: null, textScale: 1, backdrop: "solid" };
let appliedAccentKeys: string[] = [];
let listening = false;
/** Pill window: theme only. No accent, no text scale. */
let themeOnly = false;

const hasDom = () => typeof document !== "undefined";
const media = (q: string) => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(q) : null);

function render() {
  if (!hasDom()) return;
  const el = document.documentElement;
  const resolved = resolveTheme(state.theme, media("(prefers-color-scheme: dark)")?.matches ?? false);
  el.dataset.theme = resolved;
  el.classList.remove("light", "dark");
  el.classList.add(resolved);
  el.style.colorScheme = resolved;
  el.dataset.reduceMotion = String(media("(prefers-reduced-motion: reduce)")?.matches ?? false);
  el.dataset.backdrop = state.backdrop;

  if (themeOnly) return;
  for (const k of appliedAccentKeys) el.style.removeProperty(k);
  const vars = accentVars(state.accentSource, state.accent, resolved);
  appliedAccentKeys = vars ? Object.keys(vars) : [];
  if (vars) for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);

  el.style.fontSize = state.textScale === 1 ? "" : `${state.textScale * 100}%`;
}

function cache() {
  try {
    localStorage.setItem(THEME_KEY, state.theme);
    localStorage.setItem(ACCENT_SOURCE_KEY, state.accentSource);
    localStorage.setItem(TEXT_SCALE_KEY, String(state.textScale));
    if (state.accent) localStorage.setItem(ACCENT_KEY, JSON.stringify(state.accent));
    else localStorage.removeItem(ACCENT_KEY);
  } catch {
    /* storage unavailable: the choice still applies for this session */
  }
}

function listen() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  media("(prefers-color-scheme: dark)")?.addEventListener("change", render);
  media("(prefers-reduced-motion: reduce)")?.addEventListener("change", render);
  // Another window (same origin) changed the theme: follow it.
  window.addEventListener("storage", (e) => {
    if (e.key === THEME_KEY || e.key === ACCENT_SOURCE_KEY || e.key === TEXT_SCALE_KEY || e.key === ACCENT_KEY) loadCached();
  });
}

function parseAccent(raw: string): SystemAccent | null {
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    const keys = ["accent", "light1", "light2", "light3", "dark1", "dark2", "dark3"] as const;
    return keys.every((k) => typeof v[k] === "string" && /^#[0-9a-f]{6}$/i.test(v[k] as string)) ? (v as unknown as SystemAccent) : null;
  } catch {
    return null;
  }
}

function loadCached() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === "system" || t === "light" || t === "dark") state.theme = t;
    const a = localStorage.getItem(ACCENT_SOURCE_KEY);
    if (a === "utter" || a === "windows") state.accentSource = a;
    if (themeOnly) return render();
    const ts = localStorage.getItem(TEXT_SCALE_KEY);
    if (ts !== null) state.textScale = clampTextScale(Number(ts));
    const acc = localStorage.getItem(ACCENT_KEY);
    state.accent = acc ? parseAccent(acc) : null;
  } catch {
    /* ignore */
  }
  render();
}

/** Apply theme and accent source. Call whenever the settings change. */
export function applyAppearance(next: { theme: ThemePref; accentSource?: AccentSource }): void {
  state.theme = next.theme;
  state.accentSource = next.accentSource ?? "utter";
  cache();
  listen();
  render();
}

/** Apply the last known choice before first paint (no flash). */
export function applyCachedAppearance(opts: { themeOnly?: boolean } = {}): void {
  themeOnly = opts.themeOnly === true;
  listen();
  loadCached();
}

export function setSystemAccent(accent: SystemAccent | null): void {
  state.accent = accent;
  cache();
  render();
}

export function setTextScale(factor: number): void {
  state.textScale = clampTextScale(factor);
  cache();
  render();
}

export function setBackdrop(kind: BackdropKind): void {
  state.backdrop = kind;
  render();
}
