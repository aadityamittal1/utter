import { describe, expect, it } from "vitest";
import { validateWord } from "./validate";

describe("validateWord", () => {
  it("accepts a plain word", () => expect(validateWord("Tauri", "")).toBeNull());
  it("rejects empty", () => expect(validateWord("  ", "")).toMatch(/Enter a word/));
  it("rejects over 60 chars", () => expect(validateWord("x".repeat(61), "")).toMatch(/60/));
  it("accepts exactly 60", () => expect(validateWord("x".repeat(60), "")).toBeNull());
  it("rejects heardAs equal to word", () => expect(validateWord("Tauri", "tauri")).toMatch(/same/));
  it("rejects long heardAs", () => expect(validateWord("a", "y".repeat(61))).toMatch(/60/));
});
