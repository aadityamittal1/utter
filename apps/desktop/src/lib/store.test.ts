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

  it("keeps a later edit when settings://changed for an earlier save arrives mid-flight", async () => {
    const sent: Settings[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    vi.spyOn(ipc, "updateSettings").mockImplementation(async (s) => {
      sent.push(structuredClone(s));
      if (sent.length === 1) await gate; // hold A open
      return structuredClone(s);
    });
    const before = useSettings.getState().settings!;
    const a = useSettings.getState().update({ sounds: !before.sounds });
    await delay(0);
    const b = useSettings.getState().update({ showPill: !before.showPill });
    // backend event for A carries A's snapshot only (no B)
    useSettings.getState().replace({ ...before, sounds: !before.sounds });
    expect(useSettings.getState().settings).toMatchObject({ sounds: !before.sounds, showPill: !before.showPill });
    release();
    await Promise.all([a, b]);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ sounds: !before.sounds, showPill: !before.showPill });
    expect(useSettings.getState().settings).toMatchObject({ sounds: !before.sounds, showPill: !before.showPill });
  });

  it("treats a save that never settles as a failure so the queue keeps moving", async () => {
    vi.useFakeTimers();
    try {
      let n = 0;
      vi.spyOn(ipc, "updateSettings").mockImplementation((s) => (++n === 1 ? new Promise(() => undefined) : Promise.resolve(structuredClone(s))));
      const before = useSettings.getState().settings!;
      const a = useSettings.getState().update({ sounds: !before.sounds });
      const b = useSettings.getState().update({ showPill: !before.showPill });
      await vi.advanceTimersByTimeAsync(15_001);
      await Promise.all([a, b]);
      const now = useSettings.getState().settings!;
      expect(now.sounds).toBe(before.sounds);
      expect(now.showPill).toBe(!before.showPill);
      expect(n).toBe(2);
    } finally {
      vi.useRealTimers();
    }
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
