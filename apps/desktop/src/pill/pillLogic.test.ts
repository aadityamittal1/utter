import rustWindows from "../../src-tauri/src/windows.rs?raw";
import { describe, expect, it } from "vitest";
import {
  BAR_COUNT,
  BAR_MAX_PX,
  BAR_MIN_PX,
  barHeight,
  barScale,
  effectiveElapsed,
  frameCoef,
  CAPSULE_BOTTOM_MARGIN,
  CAPSULE_SIZES,
  ariaLabel,
  capsuleSize,
  clickAction,
  hoverKeys,
  menuAllowed,
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
  it("always returns 9 clamped values", () => {
    const out = smoothLevels([], [2, -1, Number.NaN]);
    expect(out).toHaveLength(BAR_COUNT);
    expect(out.every((v) => v >= 0 && v <= 1)).toBe(true);
  });
  it("attacks faster than it releases", () => {
    const up = smoothLevels(new Array(BAR_COUNT).fill(0), new Array(BAR_COUNT).fill(1))[0];
    const down = 1 - smoothLevels(new Array(BAR_COUNT).fill(1), new Array(BAR_COUNT).fill(0))[0];
    expect(up).toBeGreaterThan(down);
  });
  it("settles to exactly zero", () => {
    let v = new Array(BAR_COUNT).fill(0.5);
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
  it("has a static profile of 9", () => {
    expect(staticBarHeights()).toHaveLength(9);
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
  it("matches the contract table", () => {
    expect(capsuleSize("idle")).toEqual({ w: 44, h: 8 });
    expect(capsuleSize("hover")).toEqual({ w: 196, h: 32 });
    expect(capsuleSize("listening")).toEqual({ w: 148, h: 36 });
    expect(capsuleSize("warning")).toEqual({ w: 148, h: 36 });
    expect(capsuleSize("locked")).toEqual({ w: 212, h: 36 });
    expect(capsuleSize("thinking")).toEqual({ w: 72, h: 36 });
    expect(capsuleSize("done")).toEqual({ w: 212, h: 36 });
    expect(capsuleSize("error")).toEqual({ w: 280, h: 36 });
  });
  it("mirrors pill_capsule_rect in the Rust source", () => {
    const body = rustWindows.slice(rustWindows.indexOf("pub fn pill_capsule_rect"));
    const arm = (arm: string) => {
      const re = new RegExp(String.raw`${arm} => \((\d+), (\d+)\)`);
      const m = re.exec(body);
      if (!m) throw new Error("arm not found: " + re);
      return { w: Number(m[1]), h: Number(m[2]) };
    };
    expect(CAPSULE_SIZES.hover).toEqual(arm("Idle if hover"));
    expect(CAPSULE_SIZES.idle).toEqual(arm("PillKind::Idle"));
    expect(CAPSULE_SIZES.listening).toEqual(arm("Listening"));
    expect(CAPSULE_SIZES.locked).toEqual(arm("Locked"));
    expect(CAPSULE_SIZES.thinking).toEqual(arm("Thinking"));
    expect(CAPSULE_SIZES.done).toEqual(arm("Done"));
    expect(CAPSULE_SIZES.error).toEqual(arm("Error"));
    expect(CAPSULE_SIZES.warning).toEqual(arm("Listening"));
    for (const s of Object.values(CAPSULE_SIZES)) expect(s.w % 2).toBe(0);
    const konst = (name: string) => Number(new RegExp(String.raw`const ${name}: u32 = (\d+);`).exec(rustWindows)?.[1]);
    expect(CAPSULE_SIZES.menu.w).toBeLessThanOrEqual(konst("MENU_W"));
    expect(CAPSULE_SIZES.menu.h).toBeLessThanOrEqual(konst("MENU_H"));
    expect(CAPSULE_BOTTOM_MARGIN).toBe(Number(/CAPSULE_BOTTOM_MARGIN: i32 = (\d+)/.exec(rustWindows)?.[1]));
    expect(rustWindows).toMatch(/const PILL_W: f64 = 360.0/);
    expect(rustWindows).toMatch(/const PILL_H: f64 = 72.0/);
    expect(rustWindows).toMatch(/CAPSULE_BOTTOM_MARGIN: i32 = 8/);
  });
  it("keeps the menu inside Rust's 340x40 menu rect and every capsule inside the window", () => {
    expect(CAPSULE_SIZES.menu.w).toBeLessThanOrEqual(340);
    expect(CAPSULE_SIZES.menu.h).toBeLessThanOrEqual(40);
    for (const s of Object.values(CAPSULE_SIZES)) {
      expect(s.w).toBeLessThanOrEqual(360);
      expect(s.h + 8).toBeLessThanOrEqual(72);
    }
  });
});

describe("viewFor hover", () => {
  const base = { mode: "dictate", elapsedMs: 0 };
  it("only idle grows on hover", () => {
    expect(viewFor({ ...base, state: "idle" }, false, true)).toBe("hover");
    expect(viewFor({ ...base, state: "idle" }, false, false)).toBe("idle");
    expect(viewFor({ ...base, state: "listening" }, false, true)).toBe("listening");
    expect(viewFor({ ...base, state: "idle" }, true, true)).toBe("menu");
  });
});

describe("clickAction", () => {
  it("routes clicks by view", () => {
    expect(clickAction("idle")).toBe("start");
    expect(clickAction("hover")).toBe("start");
    for (const v of ["listening", "warning", "locked"] as const) expect(clickAction(v)).toBe("toggle");
    for (const v of ["thinking", "done", "error", "menu"] as const) expect(clickAction(v)).toBeNull();
  });
});

describe("menuAllowed", () => {
  it("mirrors Rust menu_allowed", () => {
    const b = { mode: "dictate", elapsedMs: 0 };
    expect(menuAllowed({ ...b, state: "idle" })).toBe(true);
    expect(menuAllowed({ ...b, state: "listening" })).toBe(true);
    expect(menuAllowed({ ...b, state: "error" })).toBe(true);
    expect(menuAllowed({ ...b, state: "thinking" })).toBe(false);
    expect(menuAllowed({ ...b, state: "done" })).toBe(false);
  });
});

describe("hoverKeys", () => {
  it("splits a chord into keycaps", () => {
    expect(hoverKeys("Ctrl+Win")).toEqual(["Ctrl", "Win"]);
  });
  it("falls back for missing or too-long chords", () => {
    expect(hoverKeys(undefined)).toBeNull();
    expect(hoverKeys("")).toBeNull();
    expect(hoverKeys("Ctrl+Alt+Shift+Win")).toBeNull();
    expect(hoverKeys("Ctrl+Shift+Backspace")).toBeNull();
    expect(hoverKeys("Ctrl+Shift")).toEqual(["Ctrl", "Shift"]);
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
    const target = new Array(BAR_COUNT).fill(1);
    const one = smoothLevels(new Array(BAR_COUNT).fill(0), target, 40)[0];
    let two = new Array(BAR_COUNT).fill(0);
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

describe("ariaLabel", () => {
  const b = { mode: "dictate", elapsedMs: 0 };
  it("announces the 1 minute warning with one constant string", () => {
    expect(ariaLabel({ ...b, state: "listening", elapsedMs: 19 * 60_000 })).toBe("Recording stops in 1 minute");
    expect(ariaLabel({ ...b, state: "listening", elapsedMs: 19 * 60_000 + 30_000 })).toBe("Recording stops in 1 minute");
    expect(ariaLabel({ ...b, state: "locked", elapsedMs: 19 * 60_000 })).toBe("Recording stops in 1 minute");
    expect(ariaLabel({ ...b, state: "listening", elapsedMs: 1000 })).toBe("Listening");
  });
});
