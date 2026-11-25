import type { Action, CategoryRule, ModelStatus, Settings } from "../../lib/types";

export const LANGUAGES: Array<{ code: string; name: string }> = [
  ["en", "English"], ["zh", "Chinese"], ["de", "German"], ["es", "Spanish"], ["ru", "Russian"], ["ko", "Korean"],
  ["fr", "French"], ["ja", "Japanese"], ["pt", "Portuguese"], ["tr", "Turkish"], ["pl", "Polish"], ["ca", "Catalan"],
  ["nl", "Dutch"], ["ar", "Arabic"], ["sv", "Swedish"], ["it", "Italian"], ["id", "Indonesian"], ["hi", "Hindi"],
  ["fi", "Finnish"], ["vi", "Vietnamese"], ["he", "Hebrew"], ["uk", "Ukrainian"], ["el", "Greek"], ["ms", "Malay"],
  ["cs", "Czech"], ["ro", "Romanian"], ["da", "Danish"], ["hu", "Hungarian"], ["ta", "Tamil"], ["no", "Norwegian"],
].map(([code, name]) => ({ code, name }));

export interface ShortcutConflict {
  chord: string;
  actions: Action[];
}

const MOD_ORDER = ["ctrl", "win", "alt", "shift"];
const ALIASES: Record<string, string> = { control: "ctrl", meta: "win", super: "win", windows: "win", cmd: "win", escape: "esc", option: "alt" };

/** Canonical form for comparing chords: lowercase, aliases resolved, modifiers in Ctrl+Win+Alt+Shift order. */
export function normalizeChord(c: string): string {
  const parts = c
    .split("+")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .map((p) => ALIASES[p] ?? p);
  const mods = MOD_ORDER.filter((m) => parts.includes(m));
  const rest = [...new Set(parts.filter((p) => !MOD_ORDER.includes(p)))];
  return [...mods, ...rest].join("+");
}
const norm = normalizeChord;

type Shortcuts = Settings["shortcuts"];

/** Chords bound to more than one action. */
export function findConflicts(shortcuts: Shortcuts): ShortcutConflict[] {
  const byChord = new Map<string, ShortcutConflict>();
  for (const [action, chords] of Object.entries(shortcuts) as Array<[Action, string[] | undefined]>) {
    const list = (chords ?? []).filter(Boolean);
    for (const key of new Set(list.map(norm))) {
      const cur = byChord.get(key) ?? { chord: list.find((c) => norm(c) === key) ?? key, actions: [] };
      cur.actions.push(action);
      byChord.set(key, cur);
    }
  }
  return [...byChord.values()].filter((c) => c.actions.length > 1);
}

/** Other actions that use `chord`, excluding `self`. */
export function conflictsFor(shortcuts: Shortcuts, self: Action, chord: string): Action[] {
  const n = norm(chord);
  return (Object.entries(shortcuts) as Array<[Action, string[] | undefined]>)
    .filter(([a, cs]) => a !== self && (cs ?? []).some((c) => norm(c) === n))
    .map(([a]) => a);
}

/** Replace binding `index` of an action (or append when index is past the end). */
export function setBinding(shortcuts: Shortcuts, action: Action, index: number, chord: string): Shortcuts {
  const list = [...(shortcuts[action] ?? [])];
  if (index >= list.length) list.push(chord);
  else list[index] = chord;
  return { ...shortcuts, [action]: list.filter(Boolean) };
}

export function removeBinding(shortcuts: Shortcuts, action: Action, index: number): Shortcuts {
  return { ...shortcuts, [action]: (shortcuts[action] ?? []).filter((_, i) => i !== index) };
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [it] = next.splice(from, 1);
  next.splice(to, 0, it);
  return next;
}

/** Drop empty strings so the backend sees undefined, not "". */
export function cleanRule(r: CategoryRule): CategoryRule {
  const out: CategoryRule = { category: r.category };
  if (r.process?.trim()) out.process = r.process.trim();
  if (r.titleContains?.trim()) out.titleContains = r.titleContains.trim();
  return out;
}

export interface ModelTraits {
  speed: string;
  accuracy: string;
  blurb: string;
}

/** Accuracy / speed label for a model id (backend catalog: base, small-q5_1, large-v3-turbo-q5_0). */
export function modelTraits(m: Pick<ModelStatus, "id" | "sizeBytes">): ModelTraits {
  const id = m.id.toLowerCase();
  if (id.startsWith("large") || m.sizeBytes > 1_000_000_000) {
    return { speed: "Slower", accuracy: "Most accurate", blurb: "Best for accents, jargon and noisy rooms." };
  }
  if (id.startsWith("small") || id.startsWith("medium") || m.sizeBytes > 300_000_000) {
    return { speed: "Fast", accuracy: "Balanced", blurb: "Great accuracy for everyday dictation." };
  }
  return { speed: "Fastest", accuracy: "Good", blurb: "Instant results on any PC. Fine for clear speech." };
}

export function actionLabel(action: Action, transformNames: Record<string, string> = {}): string {
  if (action.startsWith("transform:")) return transformNames[action.slice(10)] ?? "Transform";
  const map: Record<string, string> = {
    dictate: "Dictate",
    handsFree: "Hands-free",
    dictateEnhance: "Dictate & enhance",
    command: "Command",
    cancel: "Cancel",
    pasteLast: "Paste last",
    copyLast: "Copy last",
    quickNote: "Quick note",
  };
  return map[action] ?? action;
}

export const CATEGORY_LABELS: Record<string, string> = {
  email: "Email",
  workChat: "Work chat",
  personalChat: "Personal chat",
  aiPrompt: "AI prompt",
  code: "Code",
  document: "Document",
  other: "Other",
};

/** Open a URL in the system browser (Tauri opener when available, else a new tab). */
export async function openExternal(url: string): Promise<void> {
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export function without<T>(rec: Record<string, T>, key: string): Record<string, T> {
  const next = { ...rec };
  delete next[key];
  return next;
}
