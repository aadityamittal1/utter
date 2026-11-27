import { describe, expect, it } from "vitest";
import { accentVars, clampTextScale, pickOnColor, resolveTheme, type SystemAccent } from "./appearance";

const ACCENT: SystemAccent = {
  accent: "#0078d4",
  light1: "#3a96dd",
  light2: "#60aae6",
  light3: "#99ebff",
  dark1: "#005a9e",
  dark2: "#004275",
  dark3: "#002f52",
};

describe("resolveTheme", () => {
  it("follows the system when the preference is system", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
  it("ignores the system when the user picked a theme", () => {
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
  });
});

describe("clampTextScale", () => {
  it("keeps values inside 1..2.25", () => {
    expect(clampTextScale(1)).toBe(1);
    expect(clampTextScale(1.5)).toBe(1.5);
    expect(clampTextScale(0.5)).toBe(1);
    expect(clampTextScale(3)).toBe(2.25);
  });
  it("falls back to 1 for junk", () => {
    expect(clampTextScale(Number.NaN)).toBe(1);
    expect(clampTextScale(Number.POSITIVE_INFINITY)).toBe(1);
    expect(clampTextScale(undefined)).toBe(1);
  });
});

describe("pickOnColor", () => {
  it("uses dark text on light fills and white on dark fills", () => {
    expect(pickOnColor("#ff5a36")).toBe("#1a1814");
    expect(pickOnColor("#60aae6")).toBe("#1a1814");
    expect(pickOnColor("#002f52")).toBe("#ffffff");
  });
});

describe("accentVars", () => {
  it("returns nothing for the Utter accent", () => {
    expect(accentVars("utter", ACCENT, "dark")).toBeNull();
  });
  it("returns nothing when the system accent is unknown", () => {
    expect(accentVars("windows", null, "light")).toBeNull();
  });
  it("uses Light2 for text in dark and Dark1 in light", () => {
    expect(accentVars("windows", ACCENT, "dark")?.["--ember-text"]).toBe("#60aae6");
    expect(accentVars("windows", ACCENT, "light")?.["--ember-text"]).toBe("#005a9e");
  });
  it("sets the fill and exposes every shade", () => {
    const v = accentVars("windows", ACCENT, "light")!;
    expect(v["--ember"]).toBe("#0078d4");
    expect(v["--accent-fill"]).toBe("#0078d4");
    expect(v["--accent-light3"]).toBe("#99ebff");
    expect(v["--accent-dark3"]).toBe("#002f52");
    expect(v["--on-ember"]).toBe("#ffffff");
  });
});
