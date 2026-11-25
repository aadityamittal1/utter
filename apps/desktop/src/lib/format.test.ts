import { describe, expect, it } from "vitest";
import { formatChord, formatDuration, formatNumber, formatUsd, relativeDay } from "./format";

describe("format", () => {
  it("splits chords", () => {
    expect(formatChord("Ctrl+Win+Shift")).toEqual(["Ctrl", "Win", "Shift"]);
    expect(formatChord(["Esc"])).toEqual(["Esc"]);
    expect(formatChord("")).toEqual([]);
  });

  it("labels relative days", () => {
    const now = new Date(2026, 10, 24, 15, 0).getTime(); // Tue Nov 24 2026
    const day = 86_400_000;
    expect(relativeDay(now - 3_600_000, now)).toBe("Today");
    expect(relativeDay(now - day, now)).toBe("Yesterday");
    expect(relativeDay(now - 3 * day, now)).toBe("Saturday");
    expect(relativeDay(now - 20 * day, now)).toBe("Nov 4");
  });

  it("formats durations", () => {
    expect(formatDuration(42_000)).toBe("0:42");
    expect(formatDuration(125_000)).toBe("2:05");
    expect(formatDuration(3_725_000)).toBe("1:02:05");
    expect(formatDuration(-5)).toBe("0:00");
  });

  it("formats usd and numbers", () => {
    expect(formatUsd(0.0412)).toBe("$0.04");
    expect(formatUsd(12)).toBe("$12.00");
    expect(formatNumber(12345)).toBe("12,345");
  });
});
