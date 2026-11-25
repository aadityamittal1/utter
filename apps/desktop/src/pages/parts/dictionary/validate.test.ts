import { describe, expect, it } from "vitest";
import { countLabel, validateEntry } from "./validate";

describe("validateEntry", () => {
  it("accepts a plain word", () => expect(validateEntry("Tauri", "")).toEqual({}));
  it("rejects empty", () => expect(validateEntry("  ", "").word).toMatch(/Enter a word/));
  it("rejects over 60 chars", () => expect(validateEntry("x".repeat(61), "").word).toMatch(/60/));
  it("accepts exactly 60", () => expect(validateEntry("x".repeat(60), "")).toEqual({}));
  it("flags heardAs equal to word on the heardAs field", () => {
    const e = validateEntry("Tauri", "tauri");
    expect(e.heardAs).toMatch(/same/);
    expect(e.word).toBeUndefined();
  });
  it("flags long heardAs on the heardAs field", () => expect(validateEntry("a", "y".repeat(61)).heardAs).toMatch(/60/));
  it("reports both fields", () => expect(Object.keys(validateEntry("", "y".repeat(61)))).toEqual(["word", "heardAs"]));
});

describe("countLabel", () => {
  it("hides far from the limit and shows near it", () => {
    expect(countLabel("short")).toBeUndefined();
    expect(countLabel("x".repeat(52))).toBe("52/60");
  });
});
