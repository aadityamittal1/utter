import { describe, expect, it } from "vitest";
import { availablePresets, validateSnippet } from "./presets";

describe("availablePresets", () => {
  it("hides presets already used, ignoring case and spaces", () => {
    const left = availablePresets([" My LinkedIn "]).map((p) => p.label);
    expect(left).toEqual(["Email", "Website", "Calendar link"]);
  });
  it("returns all when none used", () => expect(availablePresets([])).toHaveLength(4));
});

describe("validateSnippet", () => {
  it("accepts a normal snippet", () => expect(validateSnippet("my linkedin", "https://x.y")).toBeNull());
  it("requires both fields", () => {
    expect(validateSnippet("", "x")).toMatch(/phrase/);
    expect(validateSnippet("a", "  ")).toMatch(/text to insert/);
  });
  it("enforces trigger 60 and expansion 4000", () => {
    expect(validateSnippet("a".repeat(61), "x")).toMatch(/60/);
    expect(validateSnippet("a".repeat(60), "x")).toBeNull();
    expect(validateSnippet("a", "x".repeat(4001))).toMatch(/4,000/);
    expect(validateSnippet("a", "x".repeat(4000))).toBeNull();
  });
});
