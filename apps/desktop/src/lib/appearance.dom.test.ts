import { describe, expect, it } from "vitest";
import type { SystemAccent } from "./types";

const ACCENT: SystemAccent = {
  accent: "#0078d4",
  light1: "#3a96dd",
  light2: "#60aae6",
  light3: "#99ebff",
  dark1: "#005a9e",
  dark2: "#004275",
  dark3: "#002f52",
};

type Listener = () => void;
function mockMedia(initial: { dark: boolean; reduce: boolean }) {
  const mq = { dark: initial.dark, reduce: initial.reduce };
  const listeners: Record<string, Set<Listener>> = { dark: new Set(), reduce: new Set() };
  window.matchMedia = ((q: string) => {
    const key = q.includes("color-scheme") ? "dark" : "reduce";
    return {
      get matches() {
        return mq[key];
      },
      addEventListener: (_: string, l: Listener) => listeners[key].add(l),
      removeEventListener: (_: string, l: Listener) => listeners[key].delete(l),
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
  return {
    set(key: "dark" | "reduce", v: boolean) {
      mq[key] = v;
      listeners[key].forEach((l) => l());
    },
  };
}

describe("applyAppearance (DOM)", () => {
  it("sets class + data-theme, follows live system changes, and removes accent vars", async () => {
    const m = mockMedia({ dark: false, reduce: false });
    const a = await import("./appearance");
    const el = document.documentElement;

    a.applyAppearance({ theme: "system" });
    expect(el.dataset.theme).toBe("light");
    expect(el.classList.contains("light")).toBe(true);
    expect(el.dataset.reduceMotion).toBe("false");

    m.set("dark", true);
    expect(el.dataset.theme).toBe("dark");
    expect(el.classList.contains("dark")).toBe(true);
    expect(el.classList.contains("light")).toBe(false);

    a.applyAppearance({ theme: "light" });
    m.set("dark", false);
    m.set("dark", true);
    expect(el.dataset.theme).toBe("light"); // an explicit choice ignores the OS

    m.set("reduce", true);
    expect(el.dataset.reduceMotion).toBe("true");

    a.setSystemAccent(ACCENT);
    a.applyAppearance({ theme: "light", accentSource: "windows" });
    expect(el.style.getPropertyValue("--ember")).toBe("#0078d4");
    a.applyAppearance({ theme: "light", accentSource: "utter" });
    expect(el.style.getPropertyValue("--ember")).toBe("");

    a.setTextScale(1.5);
    expect(el.style.fontSize).toBe("150%");
    a.setTextScale(1);
    expect(el.style.fontSize).toBe("");
    a.setBackdrop("mica");
    expect(el.dataset.backdrop).toBe("mica");
  });

  it("restores the cached text scale, accent and theme at boot", async () => {
    mockMedia({ dark: false, reduce: false });
    localStorage.setItem("utter.textScale", "2");
    localStorage.setItem("utter.accent", JSON.stringify(ACCENT));
    localStorage.setItem("utter.accentSource", "windows");
    localStorage.setItem("utter.theme", "dark");
    const a = await import("./appearance");
    a.applyCachedAppearance();
    const el = document.documentElement;
    expect(el.style.fontSize).toBe("200%");
    expect(el.dataset.theme).toBe("dark");
    expect(el.style.getPropertyValue("--ember")).toBe("#0078d4");
  });
});
