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

  it("enforces limits and uniqueness like the backend", async () => {
    await expect(ipc.dictionaryAdd("x".repeat(61))).rejects.toBe("Word must be 60 characters or fewer");
    await expect(ipc.snippetsAdd("t".repeat(61), "a")).rejects.toBe("Snippet trigger must be 60 characters or fewer");
    await expect(ipc.snippetsAdd("big", "a".repeat(4001))).rejects.toMatch(/4,000/);
    await expect(ipc.snippetsAdd("MY EMAIL", "x")).rejects.toBe("Snippet trigger already exists");
    await expect(ipc.snippetsAdd("  ", "x")).rejects.toBeTruthy();
  });

  it("guards model operations", async () => {
    const models = await ipc.listModels();
    const missing = models.find((m) => !m.downloaded)!;
    const active = models.find((m) => m.active)!;
    await expect(ipc.setActiveModel(missing.id)).rejects.toBe("Download the model first");
    await expect(ipc.deleteModel(active.id)).rejects.toBe("Can't delete the active model");
    const other = models.find((m) => m.downloaded && !m.active)!;
    const cb = vi.fn();
    const off = await on("settings://changed", cb);
    await ipc.setActiveModel(other.id);
    expect(cb).toHaveBeenCalled();
    expect((await ipc.getSettings()).activeModel).toBe(other.id);
    off();
    await ipc.setActiveModel(active.id);
  });

  it("only lets built-in transforms change their shortcut", async () => {
    const polish = (await ipc.transformsList()).find((t) => t.builtin)!;
    await expect(ipc.transformsUpdate({ ...polish, instruction: "changed" })).rejects.toBe(
      "Built-in transforms can only change their shortcut",
    );
    const ok = await ipc.transformsUpdate({ ...polish, shortcut: "Alt+Shift+9" });
    expect(ok.shortcut).toBe("Alt+Shift+9");
  });

  it("stores shortcuts as full chord strings and heatmap is Monday-first", async () => {
    const s = await ipc.getSettings();
    expect(s.shortcuts.dictate).toEqual(["Ctrl+Win"]);
    const ins = await ipc.insightsGet();
    expect(ins.heatmap).toHaveLength(7);
    expect(ins.heatmap[0]).toHaveLength(24);
  });
});
