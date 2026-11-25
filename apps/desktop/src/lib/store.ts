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

let saveQueue: Promise<void> = Promise.resolve();
let pendingSaves = 0;

export const useSettings = create<SettingsStore>((set, get) => ({
  settings: null,
  loading: true,
  error: null,
  load: async () => {
    try {
      const s = await ipc.getSettings();
      applyTheme(s.theme);
      set({ settings: s, loading: false, error: null });
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },
  update: (patch) => {
    const cur = get().settings;
    if (!cur) return Promise.resolve();
    const keys = Object.keys(patch) as Array<keyof Settings>;
    const previous: Partial<Settings> = {};
    for (const k of keys) (previous as Record<string, unknown>)[k] = cur[k];
    if (patch.theme) applyTheme(patch.theme);
    set({ settings: { ...cur, ...patch } });
    pendingSaves++;
    saveQueue = saveQueue.then(async () => {
      try {
        const latest = get().settings;
        if (!latest) return;
        const saved = await ipc.updateSettings(latest);
        pendingSaves--;
        // Only adopt the server copy when no newer local edits are waiting.
        set(pendingSaves === 0 ? { settings: saved, error: null } : { error: null });
      } catch (e) {
        pendingSaves--;
        const s = get().settings;
        const msg = typeof e === "string" ? e : e instanceof Error ? e.message : "Couldn't save settings";
        if (s) {
          const restored = { ...s, ...previous };
          if (previous.theme) applyTheme(previous.theme);
          set({ settings: restored, error: msg });
        }
        toast.error(msg);
      }
    });
    return saveQueue;
  },
  replace: (s) => {
    applyTheme(s.theme);
    set({ settings: s });
  },
}));

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
