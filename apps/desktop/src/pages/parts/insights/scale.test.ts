import { describe, expect, it } from "vitest";
import { heatLevel, topSlots } from "./scale";

describe("topSlots", () => {
  it("returns busiest non-empty slots, highest first", () => {
    const g = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
    g[0][9] = 5;
    g[3][14] = 20;
    g[6][22] = 12;
    g[2][1] = 1;
    expect(topSlots(g, 3)).toEqual([
      { d: 3, h: 14, v: 20 },
      { d: 6, h: 22, v: 12 },
      { d: 0, h: 9, v: 5 },
    ]);
    expect(topSlots(g.map((r) => r.map(() => 0)), 3)).toEqual([]);
  });
});

describe("heatLevel", () => {
  it("is 0 for empty cells or empty data", () => {
    expect(heatLevel(0, 10)).toBe(0);
    expect(heatLevel(5, 0)).toBe(0);
  });
  it("buckets by share of max", () => {
    expect(heatLevel(1, 100)).toBe(1);
    expect(heatLevel(26, 100)).toBe(2);
    expect(heatLevel(51, 100)).toBe(3);
    expect(heatLevel(100, 100)).toBe(4);
  });
});
