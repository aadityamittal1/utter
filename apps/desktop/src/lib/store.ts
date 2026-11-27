import { create } from "zustand";
import { useEffect } from "react";
import { ipc } from "./ipc";
import { useBackendEvent } from "./useBackendEvent";
import { toast as heroToast } from "@heroui/react";
import { applyAppearance, applyCachedAppearance } from "./appearance";
import type { AccentSource, Page, Settings, ThemePref } from "./types";

export const PAGES: Page[] = ["home", "history", "dictionary", "snippets", "styles", "transforms", "notes", "insights", "settings"];

export { THEME_KEY } from "./appearance";

/** Apply the theme and accent source (kept for callers that only know the theme). */
export function applyTheme(theme: ThemePref, accentSource: AccentSource = "utter") {
  applyAppearance({ theme, accentSource });
}

/** Apply the last known appearance before first paint to avoid a flash. */
export const applyCachedTheme = applyCachedAppearance;

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
    applyTheme(visible.theme, visible.accentSource);
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

const SIDEBAR_KEY = "utter.sidebarCollapsed";

interface NavStore {
  page: Page;
  navigate: (page: Page) => void;
  /** Open Settings, optionally at a section. Today this navigates to the settings page; the Settings dialog replaces it. */
  openSettings: (section?: string) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
}

/** Current page. Mirrored in the URL hash so reloads and deep links keep their place. */
export const useNav = create<NavStore>((set, get) => ({
  page: pageFromHash(),
  navigate: (page) => {
    set({ page });
    try {
      history.replaceState(null, "", `#${page}`);
    } catch {
      /* ignore */
    }
  },
  openSettings: () => get().navigate("settings"),
  sidebarCollapsed: (() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === "1";
    } catch {
      return false;
    }
  })(),
  toggleSidebar: () => {
    const next = !get().sidebarCollapsed;
    set({ sidebarCollapsed: next });
    try {
      localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
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

/** Toasts render through HeroUI; <ToastHost /> mounts the provider once per window. */
export const toast = {
  info: (m: string) => void heroToast.info(m),
  success: (m: string) => void heroToast.success(m),
  error: (m: string) => void heroToast.danger(m, { timeout: 6000 }),
};
