import { describe, expect, it } from "vitest";
import { formatCompact, homeTitle } from "./stats";

describe("formatCompact", () => {
  it("keeps small numbers exact", () => {
    expect(formatCompact(0)).toBe("0");
    expect(formatCompact(150)).toBe("150");
    expect(formatCompact(999)).toBe("999");
  });
  it("abbreviates thousands with one decimal", () => {
    expect(formatCompact(1000)).toBe("1K");
    expect(formatCompact(25_100)).toBe("25.1K");
    expect(formatCompact(25_149)).toBe("25.1K");
  });
  it("abbreviates millions", () => {
    expect(formatCompact(1_240_000)).toBe("1.2M");
  });
  it("clamps negatives and rounds fractions", () => {
    expect(formatCompact(-4)).toBe("0");
    expect(formatCompact(149.6)).toBe("150");
  });
});

describe("homeTitle", () => {
  it("greets by first name", () => expect(homeTitle("Maya Chen")).toBe("Welcome back, Maya"));
  it("falls back to Home", () => {
    expect(homeTitle("")).toBe("Home");
    expect(homeTitle("   ")).toBe("Home");
    expect(homeTitle(undefined)).toBe("Home");
  });
});
