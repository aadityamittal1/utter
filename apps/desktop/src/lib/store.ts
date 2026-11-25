import { create } from "zustand";
import { ipc, on } from "./ipc";
import type { Page, Settings, ThemePref } from "./types";

export const PAGES: Page[] = ["home", "history", "dictionary", "snippets", "styles", "transforms", "notes", "insights", "settings"];

export function applyTheme(theme: ThemePref) {
  const el = document.documentElement;
  if (theme === "system") el.removeAttribute("data-theme");
  else el.setAttribute("data-theme", theme);
}

interface SettingsStore {
  settings: Settings | null;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  /** Merge a partial update and persist it. Optimistic; rolls back on failure. */
  update: (patch: Partial<Settings>) => Promise<void>;
  /** Replace local copy (used for settings://changed). */
  replace: (s: Settings) => void;
}

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
  update: async (patch) => {
    const prev = get().settings;
    if (!prev) return;
    const optimistic = { ...prev, ...patch };
    if (patch.theme) applyTheme(patch.theme);
    set({ settings: optimistic });
    try {
      const saved = await ipc.updateSettings(optimistic);
      set({ settings: saved });
    } catch (e) {
      applyTheme(prev.theme);
      set({ settings: prev, error: String(e) });
      throw e;
    }
  },
  replace: (s) => {
    applyTheme(s.theme);
    set({ settings: s });
  },
}));

interface NavStore {
  page: Page;
  navigate: (page: Page) => void;
}

export const useNav = create<NavStore>((set) => ({
  page: "home",
  navigate: (page) => set({ page }),
}));

/** Wire backend events into the stores. Returns a cleanup function. */
export function startStoreListeners(): () => void {
  const offs: Array<Promise<() => void>> = [
    on("settings://changed", (s) => useSettings.getState().replace(s)),
    on("hub://navigate", ({ page }) => {
      if ((PAGES as string[]).includes(page)) useNav.getState().navigate(page as Page);
    }),
  ];
  return () => offs.forEach((p) => p.then((off) => off()));
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
