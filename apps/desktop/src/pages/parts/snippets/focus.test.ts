import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { focusFallback } from "./focus";

describe("focusFallback", () => {
  let target: HTMLButtonElement;
  beforeEach(() => {
    vi.useFakeTimers();
    target = document.createElement("button");
    document.body.append(target);
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("focuses the fallback when the opener was removed", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.remove();
    focusFallback(opener, () => target);
    vi.advanceTimersByTime(300);
    expect(document.activeElement).toBe(target);
  });

  it("leaves focus alone when the opener is still on the page", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    focusFallback(opener, () => target);
    vi.advanceTimersByTime(300);
    expect(document.activeElement).toBe(opener);
  });

  it("can be cancelled", () => {
    const cancel = focusFallback(null, () => target);
    cancel();
    vi.advanceTimersByTime(300);
    expect(document.activeElement).not.toBe(target);
  });
});
