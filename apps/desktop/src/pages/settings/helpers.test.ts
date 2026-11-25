import { describe, expect, it } from "vitest";
import { normalizeChord, cleanRule, conflictsFor, findConflicts, modelTraits, moveItem, removeBinding, setBinding } from "./helpers";

describe("shortcut helpers", () => {
  it("finds chords bound twice, ignoring case", () => {
    const c = findConflicts({ dictate: ["Ctrl+Win"], command: ["ctrl+win"], cancel: ["Esc"] });
    expect(c).toHaveLength(1);
    expect(c[0].actions.sort()).toEqual(["command", "dictate"]);
  });
  it("no conflict for one action with duplicate chords", () => {
    expect(findConflicts({ dictate: ["Ctrl+Win", "Ctrl+Win"] })).toEqual([]);
  });
  it("conflictsFor excludes self", () => {
    expect(conflictsFor({ dictate: ["A"], cancel: ["A"] }, "dictate", "A")).toEqual(["cancel"]);
  });
  it("sets, appends and removes bindings", () => {
    let s = setBinding({ dictate: ["A"] }, "dictate", 0, "B");
    expect(s.dictate).toEqual(["B"]);
    s = setBinding(s, "dictate", 1, "C");
    expect(s.dictate).toEqual(["B", "C"]);
    expect(removeBinding(s, "dictate", 0).dictate).toEqual(["C"]);
  });
});

describe("normalizeChord", () => {
  it("canonicalizes order and aliases", () => {
    expect(normalizeChord("Shift+Meta+Control")).toBe("ctrl+win+shift");
    expect(normalizeChord("Alt+Super+Space")).toBe("win+alt+space");
  });
  it("detects conflicts across spellings", () => {
    expect(findConflicts({ dictate: ["Win+Ctrl"], command: ["Ctrl+Meta"] })).toHaveLength(1);
  });
});

describe("misc helpers", () => {
  it("moveItem reorders and ignores out-of-range", () => {
    expect(moveItem([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
    const l = [1, 2];
    expect(moveItem(l, 0, 5)).toBe(l);
  });
  it("cleanRule trims and drops empties", () => {
    expect(cleanRule({ category: "code", process: " code.exe ", titleContains: " " })).toEqual({ category: "code", process: "code.exe" });
  });
  it("labels models", () => {
    expect(modelTraits({ id: "base", sizeBytes: 148e6 }).accuracy).toBe("Good");
    expect(modelTraits({ id: "small-q5_1", sizeBytes: 190e6 }).accuracy).toBe("Balanced");
    expect(modelTraits({ id: "large-v3-turbo-q5_0", sizeBytes: 574e6 }).accuracy).toBe("Most accurate");
  });
});
