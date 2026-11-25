import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutosaver, previewLine } from "./autosave";

describe("createAutosaver", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("saves once, 500 ms after the last edit", () => {
    const save = vi.fn();
    const a = createAutosaver<string>(save);
    a.schedule("a");
    vi.advanceTimersByTime(300);
    a.schedule("ab");
    vi.advanceTimersByTime(499);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("ab");
    expect(a.hasPending()).toBe(false);
  });

  it("flush saves the pending value immediately and only once", async () => {
    const save = vi.fn();
    const a = createAutosaver<string>(save);
    a.schedule("draft");
    await a.flush();
    expect(save).toHaveBeenCalledWith("draft");
    vi.advanceTimersByTime(1000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("flush with nothing pending is a no-op", async () => {
    const save = vi.fn();
    await createAutosaver<string>(save).flush();
    expect(save).not.toHaveBeenCalled();
  });

  it("never overlaps saves and the newest value wins", async () => {
    let active = 0;
    let maxActive = 0;
    const seen: string[] = [];
    const a = createAutosaver<string>(async (v) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 300));
      seen.push(v);
      active--;
    });
    a.schedule("one");
    vi.advanceTimersByTime(500); // save "one" starts
    a.schedule("two");
    vi.advanceTimersByTime(500); // timer fires while "one" is in flight
    await vi.advanceTimersByTimeAsync(2000);
    await a.flush();
    expect(maxActive).toBe(1);
    expect(seen).toEqual(["one", "two"]);
  });

  it("keeps a failed value pending and retries on flush", async () => {
    const save = vi.fn().mockRejectedValueOnce("boom").mockResolvedValue(undefined);
    const a = createAutosaver<string>(save);
    a.schedule("x");
    expect(await a.flush()).toBe(false);
    expect(a.hasPending()).toBe(true);
    expect(await a.flush()).toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith("x");
  });

  it("a newer edit replaces a failed value", async () => {
    const save = vi.fn().mockRejectedValueOnce("boom").mockResolvedValue(undefined);
    const a = createAutosaver<string>(save);
    a.schedule("old");
    await a.flush();
    a.schedule("new");
    await a.flush();
    expect(save).toHaveBeenLastCalledWith("new");
  });

  it("cancel drops the pending save", () => {
    const save = vi.fn();
    const a = createAutosaver<string>(save);
    a.schedule("x");
    a.cancel();
    vi.advanceTimersByTime(1000);
    expect(save).not.toHaveBeenCalled();
  });
});

describe("previewLine", () => {
  it("returns the first non-empty line", () => expect(previewLine("\n  \n hello \nworld")).toBe("hello"));
  it("returns empty for blank", () => expect(previewLine("  \n")).toBe(""));
});
