import { isTauri } from "../lib/ipc";

export const STEP_KEY = "utter.onboarding.step";
export const STEP_COUNT = 8;

export function loadStep(): number {
  try {
    const n = Number(localStorage.getItem(STEP_KEY));
    return Number.isInteger(n) && n >= 0 && n < STEP_COUNT ? n : 0;
  } catch {
    return 0;
  }
}

export function saveStep(n: number): void {
  try {
    localStorage.setItem(STEP_KEY, String(n));
  } catch {
    /* storage unavailable: onboarding just isn't resumable */
  }
}

export function clearStep(): void {
  try {
    localStorage.removeItem(STEP_KEY);
  } catch {
    /* ignore */
  }
}

/** Open a link in the user's browser (opener plugin in Tauri, new tab otherwise). */
export async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
      return;
    } catch {
      /* fall through to window.open */
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

const hasScheme = (s: string) => /^[a-z][a-z0-9+.-]*:\/\//i.test(s);

/** "linkedin.com/in/maya" -> "https://linkedin.com/in/maya"; empty stays empty. */
export function normalizeUrl(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  return hasScheme(s) ? s : `https://${s}`;
}

export function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());
}

export function isValidUrl(raw: string): boolean {
  const s = normalizeUrl(raw);
  if (!s) return false;
  try {
    const u = new URL(s);
    return (u.protocol === "https:" || u.protocol === "http:") && /\.[a-z]{2,}$/i.test(u.hostname);
  } catch {
    return false;
  }
}

export interface PersonalInputs {
  linkedin: string;
  email: string;
  website: string;
}

export interface SnippetDraft {
  trigger: string;
  expansion: string;
}

/** Field-level validation errors (only for non-empty fields). */
export function validatePersonal(p: PersonalInputs): Partial<Record<keyof PersonalInputs, string>> {
  const errors: Partial<Record<keyof PersonalInputs, string>> = {};
  if (p.linkedin.trim() && !isValidUrl(p.linkedin)) errors.linkedin = "That doesn't look like a link.";
  if (p.email.trim() && !isValidEmail(p.email)) errors.email = "That doesn't look like an email address.";
  if (p.website.trim() && !isValidUrl(p.website)) errors.website = "That doesn't look like a link.";
  return errors;
}

/** Snippets to create: empty fields are skipped. */
export function buildSnippets(p: PersonalInputs): SnippetDraft[] {
  const out: SnippetDraft[] = [];
  if (p.linkedin.trim()) out.push({ trigger: "my linkedin", expansion: normalizeUrl(p.linkedin) });
  if (p.email.trim()) out.push({ trigger: "my email", expansion: p.email.trim() });
  if (p.website.trim()) out.push({ trigger: "my website", expansion: normalizeUrl(p.website) });
  return out;
}

/** Pick the model to preselect: the recommended one, else the active one, else the first. */
export function pickModel<T extends { id: string; recommended: boolean; active: boolean }>(models: T[]): T | undefined {
  return models.find((m) => m.recommended) ?? models.find((m) => m.active) ?? models[0];
}

export const MODEL_KEY = "utter.onboarding.model";

export function loadModelId(): string | null {
  try {
    return localStorage.getItem(MODEL_KEY);
  } catch {
    return null;
  }
}

export function saveModelId(id: string): void {
  try {
    localStorage.setItem(MODEL_KEY, id);
  } catch {
    /* ignore */
  }
}

export function clearModelId(): void {
  try {
    localStorage.removeItem(MODEL_KEY);
  } catch {
    /* ignore */
  }
}

export interface ModelAction {
  kind: "ready" | "activate" | "pending" | "none";
  id?: string;
}

/**
 * What to do about the speech model right now. `chosenId` is the model the user
 * picked during onboarding (null if they never got that far).
 */
export function modelAction(models: Array<{ id: string; recommended: boolean; downloaded: boolean; active: boolean }>, chosenId: string | null): ModelAction {
  const chosen = chosenId ? models.find((m) => m.id === chosenId) : undefined;
  if (chosen) {
    if (!chosen.downloaded) return { kind: "pending", id: chosen.id };
    return { kind: chosen.active ? "ready" : "activate", id: chosen.id };
  }
  if (models.some((m) => m.active && m.downloaded)) return { kind: "ready" };
  const rec = models.find((m) => m.recommended && m.downloaded) ?? models.find((m) => m.downloaded);
  return rec ? { kind: "activate", id: rec.id } : { kind: "none" };
}
