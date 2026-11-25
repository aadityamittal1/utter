import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ipc } from "./ipc";
import { useNav, useSettings, useToasts } from "./store";
import type { Settings } from "./types";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("settings store", () => {
  beforeEach(async () => {
    useToasts.setState({ items: [] });
    await useSettings.getState().load();
  });
  afterEach(() => vi.restoreAllMocks());

  it("keeps both edits when updates overlap, and persists them in order", async () => {
    const real = ipc.updateSettings.bind(ipc);
    const seen: Settings[] = [];
    vi.spyOn(ipc, "updateSettings").mockImplementation(async (s) => {
      seen.push(structuredClone(s));
      await delay(seen.length === 1 ? 30 : 1); // first call is slower
      return real(s);
    });
    const before = useSettings.getState().settings!;
    const a = useSettings.getState().update({ sounds: !before.sounds });
    const b = useSettings.getState().update({ showPill: !before.showPill });
    // UI reflects both immediately
    expect(useSettings.getState().settings).toMatchObject({ sounds: !before.sounds, showPill: !before.showPill });
    await Promise.all([a, b]);
    expect(useSettings.getState().settings).toMatchObject({ sounds: !before.sounds, showPill: !before.showPill });
    expect(seen).toHaveLength(2);
    expect((await ipc.getSettings()).showPill).toBe(!before.showPill);
  });

  it("rolls back only the failed call's keys, toasts, and does not reject", async () => {
    const real = ipc.updateSettings.bind(ipc);
    let n = 0;
    vi.spyOn(ipc, "updateSettings").mockImplementation(async (s) => {
      if (++n === 1) throw "Disk is full";
      return real(s);
    });
    const before = useSettings.getState().settings!;
    const a = useSettings.getState().update({ sounds: !before.sounds });
    const b = useSettings.getState().update({ showPill: !before.showPill });
    await expect(Promise.all([a, b])).resolves.toBeDefined();
    const now = useSettings.getState().settings!;
    expect(now.sounds).toBe(before.sounds); // A rolled back
    expect(now.showPill).toBe(!before.showPill); // B kept
    expect(useToasts.getState().items.some((t) => t.kind === "error" && t.message === "Disk is full")).toBe(true);
  });

  it("clears the error after a successful save", async () => {
    useSettings.setState({ error: "old" });
    await useSettings.getState().update({ keepMicWarm: true });
    expect(useSettings.getState().error).toBeNull();
  });
});

describe("nav store", () => {
  it("navigates and mirrors the page in the URL hash", () => {
    useNav.getState().navigate("settings");
    expect(useNav.getState().page).toBe("settings");
    expect(location.hash).toBe("#settings");
  });
});
