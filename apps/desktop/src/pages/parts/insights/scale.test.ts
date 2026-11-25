import { describe, expect, it } from "vitest";
import { heatLevel } from "./scale";

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
