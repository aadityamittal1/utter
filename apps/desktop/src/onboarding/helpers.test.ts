import { beforeEach, describe, expect, it } from "vitest";
import { buildSnippets, isValidEmail, isValidUrl, loadStep, normalizeUrl, pickModel, saveStep, STEP_KEY, validatePersonal } from "./helpers";

describe("onboarding helpers", () => {
  beforeEach(() => localStorage.clear());

  it("normalizes urls", () => {
    expect(normalizeUrl(" linkedin.com/in/maya ")).toBe("https://linkedin.com/in/maya");
    expect(normalizeUrl("http://a.io")).toBe("http://a.io");
    expect(normalizeUrl("  ")).toBe("");
  });

  it("validates email and url", () => {
    expect(isValidEmail("maya@example.com")).toBe(true);
    expect(isValidEmail("maya@example")).toBe(false);
    expect(isValidUrl("maya.dev")).toBe(true);
    expect(isValidUrl("not a url")).toBe(false);
    expect(isValidUrl("javascript:alert(1)")).toBe(false);
  });

  it("builds snippets and skips empty fields", () => {
    expect(buildSnippets({ linkedin: "", email: "a@b.co", website: "b.co" })).toEqual([
      { trigger: "my email", expansion: "a@b.co" },
      { trigger: "my website", expansion: "https://b.co" },
    ]);
    expect(buildSnippets({ linkedin: "", email: "", website: "" })).toEqual([]);
  });

  it("only reports errors for filled invalid fields", () => {
    expect(validatePersonal({ linkedin: "", email: "nope", website: "x.dev" })).toEqual({ email: expect.any(String) });
  });

  it("round-trips the resumable step and rejects garbage", () => {
    expect(loadStep()).toBe(0);
    saveStep(4);
    expect(loadStep()).toBe(4);
    localStorage.setItem(STEP_KEY, "99");
    expect(loadStep()).toBe(0);
  });

  it("prefers the recommended model", () => {
    const ms = [
      { id: "a", recommended: false, active: true },
      { id: "b", recommended: true, active: false },
    ];
    expect(pickModel(ms)?.id).toBe("b");
  });
});
