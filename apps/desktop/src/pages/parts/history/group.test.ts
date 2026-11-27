import { describe, expect, it } from "vitest";
import type { HistoryItem } from "../../../lib/types";
import { clockLabel, dayLabel, groupByDay } from "./group";

const NOW = new Date(2026, 10, 26, 15, 0, 0).getTime(); // Thu Nov 26 2026, 3pm local

const at = (daysAgo: number, hour: number): number => {
  const d = new Date(NOW);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
};

const item = (id: string, createdAt: number): HistoryItem => ({
  id,
  createdAt,
  appName: "Notepad",
  category: "other",
  mode: "dictate",
  rawText: id,
  finalText: id,
  durationMs: 1000,
  words: 1,
  usedAi: false,
  hasAudio: false,
});

describe("dayLabel", () => {
  it("uses Today and Yesterday", () => {
    expect(dayLabel(at(0, 9), NOW)).toBe("Today");
    expect(dayLabel(at(1, 23), NOW)).toBe("Yesterday");
  });
  it("uses a full date after that", () => {
    expect(dayLabel(at(2, 10), NOW)).toBe("Tuesday, November 24");
  });
  it("adds the year for other years", () => {
    expect(dayLabel(new Date(2025, 11, 31, 10).getTime(), NOW)).toBe("Wednesday, December 31, 2025");
  });
});

describe("groupByDay", () => {
  it("groups by calendar day and keeps order", () => {
    const groups = groupByDay([item("a", at(0, 14)), item("b", at(0, 9)), item("c", at(1, 20)), item("d", at(3, 8))], NOW);
    expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ["Today", ["a", "b"]],
      ["Yesterday", ["c"]],
      ["Monday, November 23", ["d"]],
    ]);
  });
  it("does not merge the same weekday from different weeks", () => {
    const groups = groupByDay([item("a", at(10, 9)), item("b", at(17, 9))], NOW);
    expect(groups).toHaveLength(2);
  });
  it("returns nothing for no items", () => {
    expect(groupByDay([], NOW)).toEqual([]);
  });
});

describe("clockLabel", () => {
  it("drops the space and lowercases, keeping every digit and letter", () => {
    expect(clockLabel(new Date(2026, 10, 26, 14, 35).getTime())).toMatch(/^2:35pm$/);
    expect(clockLabel(new Date(2026, 10, 26, 9, 5).getTime())).toMatch(/^9:05am$/);
  });
});
