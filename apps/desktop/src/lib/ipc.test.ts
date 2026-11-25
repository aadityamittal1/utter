import { describe, expect, it, vi } from "vitest";
import { ipc, on } from "./ipc";

describe("mock ipc", () => {
  it("seeds history, dictionary, snippets, notes and models", async () => {
    expect((await ipc.historyList(undefined, 100, 0)).length).toBe(40);
    expect((await ipc.dictionaryList()).length).toBe(6);
    const snippets = await ipc.snippetsList();
    expect(snippets.map((s) => s.trigger)).toEqual(
      expect.arrayContaining(["my linkedin", "my email", "my calendar link"]),
    );
    expect((await ipc.notesList()).length).toBe(2);
    expect((await ipc.listModels()).some((m) => m.active)).toBe(true);
  });

  it("adds a snippet and lists it, then deletes it", async () => {
    const s = await ipc.snippetsAdd("my address", "1 Example Street");
    expect((await ipc.snippetsList()).some((x) => x.id === s.id && x.trigger === "my address")).toBe(true);
    await ipc.snippetsDelete(s.id);
    expect((await ipc.snippetsList()).some((x) => x.id === s.id)).toBe(false);
  });

  it("filters history by query and paginates", async () => {
    const all = await ipc.historyList(undefined, 10, 0);
    expect(all).toHaveLength(10);
    const page2 = await ipc.historyList(undefined, 10, 10);
    expect(page2[0].id).not.toBe(all[0].id);
    const needle = all[0].finalText.split(" ")[0];
    const hits = await ipc.historyList(needle, 100, 0);
    expect(hits.length).toBeGreaterThan(0);
  });

  it("round-trips settings and emits settings://changed", async () => {
    const cb = vi.fn();
    const off = await on("settings://changed", cb);
    const s = await ipc.getSettings();
    const next = await ipc.updateSettings({ ...s, userName: "Test" });
    expect(next.userName).toBe("Test");
    expect((await ipc.getSettings()).userName).toBe("Test");
    expect(cb).toHaveBeenCalled();
    off();
  });

  it("dictionary csv import/export", async () => {
    const n = await ipc.dictionaryImportCsv("word,heardAs\nKubernetes,cooper netties\n");
    expect(n).toBe(1);
    expect(await ipc.dictionaryExportCsv()).toContain("Kubernetes");
  });
});
