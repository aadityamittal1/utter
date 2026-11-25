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
