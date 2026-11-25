import { create } from "zustand";
import { useEffect } from "react";
import { ipc } from "./ipc";
import { useBackendEvent } from "./useBackendEvent";
import type { Page, Settings, ThemePref } from "./types";

export const PAGES: Page[] = ["home", "history", "dictionary", "snippets", "styles", "transforms", "notes", "insights", "settings"];

export const THEME_KEY = "utter.theme";

export function applyTheme(theme: ThemePref) {
  const el = document.documentElement;
  if (theme === "system") el.removeAttribute("data-theme");
  else el.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* storage unavailable: theme still applies for this session */
  }
}

/** Apply the last known theme before first paint to avoid a flash. */
export function applyCachedTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
  } catch {
    /* ignore */
  }
}

interface SettingsStore {
  settings: Settings | null;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  /**
   * Merge a partial update. The UI changes immediately; persistence is
   * serialized so quick successive calls never overwrite each other. On
   * failure only this call's keys roll back and a toast is shown.
   */
  update: (patch: Partial<Settings>) => Promise<void>;
  /** Replace local copy (used for settings://changed). */
  replace: (s: Settings) => void;
}

const SAVE_TIMEOUT_MS = 15_000;

/** Last settings confirmed by the backend (a save response or settings://changed). */
let base: Settings | null = null;
/** Edits applied optimistically but not yet confirmed, oldest first. */
let pending: Array<{ id: number; patch: Partial<Settings> }> = [];
let nextPatchId = 0;
let saveQueue: Promise<void> = Promise.resolve();

const withPending = (b: Settings): Settings => pending.reduce((acc, p) => ({ ...acc, ...p.patch }), b);

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject("Saving settings timed out"), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

export const useSettings = create<SettingsStore>((set) => {
  /** Recompute the visible settings from the confirmed base plus pending edits. */
  const publish = (extra: Partial<SettingsStore> = {}) => {
    if (!base) return;
    const visible = withPending(base);
    applyTheme(visible.theme);
    set({ settings: visible, ...extra });
  };

  return {
    settings: null,
    loading: true,
    error: null,
    load: async () => {
      try {
        base = await ipc.getSettings();
        publish({ loading: false, error: null });
      } catch (e) {
        set({ loading: false, error: String(e) });
      }
    },
    update: (patch) => {
      if (!base) return Promise.resolve();
      const entry = { id: ++nextPatchId, patch };
      pending = [...pending, entry];
      publish();
      saveQueue = saveQueue.then(async () => {
        try {
          // Earlier saves are settled, so the confirmed base plus this edit is what gets persisted.
          const saved = await withTimeout(ipc.updateSettings({ ...base!, ...entry.patch }), SAVE_TIMEOUT_MS);
          base = saved;
          pending = pending.filter((p) => p.id !== entry.id);
          publish({ error: null });
        } catch (e) {
          pending = pending.filter((p) => p.id !== entry.id); // roll back only this edit
          const msg = typeof e === "string" ? e : e instanceof Error ? e.message : "Couldn't save settings";
          publish({ error: msg });
          toast.error(msg);
        }
      });
      return saveQueue;
    },
    replace: (s) => {
      base = s;
      publish();
    },
  };
});

function pageFromHash(): Page {
  const h = typeof location === "undefined" ? "" : location.hash.replace(/^#\/?/, "");
  return (PAGES as string[]).includes(h) ? (h as Page) : "home";
}

interface NavStore {
  page: Page;
  navigate: (page: Page) => void;
}

/** Current page. Mirrored in the URL hash so reloads and deep links keep their place. */
export const useNav = create<NavStore>((set) => ({
  page: pageFromHash(),
  navigate: (page) => {
    set({ page });
    try {
      history.replaceState(null, "", `#${page}`);
    } catch {
      /* ignore */
    }
  },
}));

/** Wire backend events and the URL hash into the stores. Call once in the shell. */
export function useStoreListeners(): void {
  useBackendEvent("settings://changed", (s) => useSettings.getState().replace(s));
  useBackendEvent("hub://navigate", ({ page }) => {
    if ((PAGES as string[]).includes(page)) useNav.getState().navigate(page as Page);
  });
  useEffect(() => {
    const onHash = () => useNav.setState({ page: pageFromHash() });
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
}

export type ToastKind = "info" | "success" | "error";
export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastStore {
  items: ToastItem[];
  push: (message: string, kind?: ToastKind) => void;
  dismiss: (id: number) => void;
}

let toastId = 0;
export const useToasts = create<ToastStore>((set, get) => ({
  items: [],
  push: (message, kind = "info") => {
    const id = ++toastId;
    set({ items: [...get().items.slice(-3), { id, kind, message }] });
    setTimeout(() => get().dismiss(id), kind === "error" ? 6000 : 3200);
  },
  dismiss: (id) => set({ items: get().items.filter((t) => t.id !== id) }),
}));

export const toast = {
  info: (m: string) => useToasts.getState().push(m, "info"),
  success: (m: string) => useToasts.getState().push(m, "success"),
  error: (m: string) => useToasts.getState().push(m, "error"),
};
