// Small shell helpers: external links, resolved theme, native window controls.
import { useEffect, useState } from "react";
import { isTauri } from "./ipc";
import { resolveTheme, type ResolvedTheme } from "./appearance";
import { useSettings } from "./store";

export const HELP_URL = "https://github.com/aadityamittal1/utter#readme";

/** Open a URL in the system browser (Tauri opener when available, else a new tab). */
export async function openExternal(url: string): Promise<void> {
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

/** The theme actually in effect (system resolved). Re-renders when the OS flips. */
export function useResolvedTheme(): ResolvedTheme {
  const pref = useSettings((s) => s.settings?.theme ?? "system");
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return resolveTheme(pref, systemDark);
}

export type WindowAction = "minimize" | "toggleMaximize" | "close";

/** Native window controls. No-ops in a plain browser. */
export async function windowAction(action: WindowAction): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const w = getCurrentWindow();
  if (action === "minimize") await w.minimize();
  else if (action === "toggleMaximize") await w.toggleMaximize();
  else await w.close();
}

/** Tracks whether the window is maximised (swaps the caption glyph). */
export function useMaximized(): boolean {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (!isTauri()) return;
    let off: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const w = getCurrentWindow();
      const sync = () => void w.isMaximized().then((m) => !cancelled && setMaximized(m));
      sync();
      const un = await w.onResized(sync);
      if (cancelled) un();
      else off = un;
    })().catch(() => undefined);
    return () => {
      cancelled = true;
      off?.();
    };
  }, []);
  return maximized;
}
