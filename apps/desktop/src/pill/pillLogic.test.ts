import { describe, expect, it } from "vitest";
import {
  BAR_COUNT,
  BAR_MAX_PX,
  BAR_MIN_PX,
  barHeight,
  barScale,
  effectiveElapsed,
  frameCoef,
  capsuleSize,
  formatRemaining,
  formatTimer,
  isWarning,
  showTimer,
  smoothLevels,
  staticBarHeights,
  viewFor,
} from "./pillLogic";

describe("formatTimer", () => {
  it("formats m:ss", () => {
    expect(formatTimer(0)).toBe("0:00");
    expect(formatTimer(12_999)).toBe("0:12");
    expect(formatTimer(61_000)).toBe("1:01");
    expect(formatTimer(19 * 60_000)).toBe("19:00");
  });
  it("guards bad input", () => {
    expect(formatTimer(-5)).toBe("0:00");
    expect(formatTimer(Number.NaN)).toBe("0:00");
  });
});

describe("timer and warning thresholds", () => {
  it("shows the timer from 10 s", () => {
    expect(showTimer(9_999)).toBe(false);
    expect(showTimer(10_000)).toBe(true);
  });
  it("warns from 19 min and counts down to the cap", () => {
    expect(isWarning(19 * 60_000 - 1)).toBe(false);
    expect(isWarning(19 * 60_000)).toBe(true);
    expect(formatRemaining(19 * 60_000)).toBe("1:00 left");
    expect(formatRemaining(19 * 60_000 + 18_000)).toBe("0:42 left");
    expect(formatRemaining(25 * 60_000)).toBe("0:00 left");
  });
});

describe("smoothLevels", () => {
  it("always returns 12 clamped values", () => {
    const out = smoothLevels([], [2, -1, Number.NaN]);
    expect(out).toHaveLength(BAR_COUNT);
    expect(out.every((v) => v >= 0 && v <= 1)).toBe(true);
  });
  it("attacks faster than it releases", () => {
    const up = smoothLevels(new Array(12).fill(0), new Array(12).fill(1))[0];
    const down = 1 - smoothLevels(new Array(12).fill(1), new Array(12).fill(0))[0];
    expect(up).toBeGreaterThan(down);
  });
  it("settles to exactly zero", () => {
    let v = new Array(12).fill(0.5);
    for (let i = 0; i < 60; i++) v = smoothLevels(v, []);
    expect(v.every((x) => x === 0)).toBe(true);
  });
});

describe("barHeight", () => {
  it("stays within bounds", () => {
    for (let i = 0; i < BAR_COUNT; i++) {
      expect(barHeight(0, i)).toBe(BAR_MIN_PX);
      expect(barHeight(1, i)).toBeLessThanOrEqual(BAR_MAX_PX);
      expect(barHeight(5, i)).toBeLessThanOrEqual(BAR_MAX_PX);
    }
  });
  it("is taller in the middle", () => {
    expect(barHeight(1, 6)).toBeGreaterThan(barHeight(1, 0));
  });
  it("has a static profile of 12", () => {
    expect(staticBarHeights()).toHaveLength(12);
  });
});

describe("viewFor", () => {
  const base = { mode: "dictate", elapsedMs: 0 };
  it("menu wins", () => {
    expect(viewFor({ ...base, state: "listening" }, true)).toBe("menu");
  });
  it("switches to the warning view while listening past 19 min", () => {
    expect(viewFor({ ...base, state: "listening", elapsedMs: 19 * 60_000 }, false)).toBe("warning");
    expect(viewFor({ ...base, state: "locked", elapsedMs: 19 * 60_000 }, false)).toBe("locked");
    expect(viewFor({ ...base, state: "thinking", elapsedMs: 19 * 60_000 }, false)).toBe("thinking");
  });
});

describe("capsuleSize", () => {
  it("matches the spec", () => {
    expect(capsuleSize("idle")).toEqual({ w: 40, h: 8 });
    expect(capsuleSize("listening")).toEqual({ w: 200, h: 40 });
  });
  it("fits the 360 px window for long messages", () => {
    expect(capsuleSize("error", "x".repeat(200)).w).toBeLessThanOrEqual(340);
    expect(capsuleSize("done", "x".repeat(200)).w).toBeLessThanOrEqual(260);
  });
});

describe("frame-rate independent smoothing", () => {
  it("frameCoef equals k at 40 ms and compounds across frames", () => {
    expect(frameCoef(0.6, 40)).toBeCloseTo(0.6);
    const twoFrames = 1 - (1 - frameCoef(0.6, 20)) ** 2;
    expect(twoFrames).toBeCloseTo(0.6);
    expect(frameCoef(0.6, 0)).toBe(0);
  });
  it("smoothLevels with the same total time lands in the same place", () => {
    const target = new Array(12).fill(1);
    const one = smoothLevels(new Array(12).fill(0), target, 40)[0];
    let two = new Array(12).fill(0);
    two = smoothLevels(two, target, 20);
    two = smoothLevels(two, target, 20);
    expect(two[0]).toBeCloseTo(one);
  });
});

describe("barScale", () => {
  it("is height over the fixed element height, within (0, 1]", () => {
    for (let i = 0; i < BAR_COUNT; i++) {
      expect(barScale(0, i)).toBeGreaterThan(0);
      expect(barScale(1, i)).toBeLessThanOrEqual(1);
    }
    expect(barScale(1, 6)).toBeGreaterThan(barScale(0.2, 6));
  });
});

describe("effectiveElapsed", () => {
  it("never runs behind the local clock", () => {
    expect(effectiveElapsed(1000, 4000)).toBe(4000);
    expect(effectiveElapsed(5000, 4000)).toBe(5000);
    expect(effectiveElapsed(Number.NaN, 300)).toBe(300);
  });
});
