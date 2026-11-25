import { describe, expect, it } from "vitest";
import { wordDiff } from "./diff";

describe("wordDiff", () => {
  it("returns a single same op for identical text", () => {
    expect(wordDiff("hello world", "hello world")).toEqual([{ kind: "same", text: "hello world" }]);
  });
  it("marks removed and replaced words", () => {
    expect(wordDiff("um so the plan", "so the plan")).toEqual([
      { kind: "del", text: "um" },
      { kind: "same", text: "so the plan" },
    ]);
    expect(wordDiff("meet at five", "meet at 5")).toEqual([
      { kind: "same", text: "meet at" },
      { kind: "del", text: "five" },
      { kind: "add", text: "5" },
    ]);
  });
  it("handles empty sides", () => {
    expect(wordDiff("", "new words")).toEqual([{ kind: "add", text: "new words" }]);
    expect(wordDiff("gone", "")).toEqual([{ kind: "del", text: "gone" }]);
    expect(wordDiff("", "")).toEqual([]);
  });
  it("ignores whitespace differences", () => {
    expect(wordDiff("a  b\n c", "a b c")).toEqual([{ kind: "same", text: "a b c" }]);
  });
  it("keeps common prefix and suffix as single same ops", () => {
    expect(wordDiff("one two X three four", "one two Y three four")).toEqual([
      { kind: "same", text: "one two" },
      { kind: "del", text: "X" },
      { kind: "add", text: "Y" },
      { kind: "same", text: "three four" },
    ]);
  });
  it("falls back to plain before/after for huge changed regions", () => {
    const a = Array.from({ length: 2100 }, (_, i) => `a${i}`).join(" ");
    const b = Array.from({ length: 2100 }, (_, i) => `b${i}`).join(" ");
    const ops = wordDiff(`start ${a} end`, `start ${b} end`);
    expect(ops.map((o) => o.kind)).toEqual(["same", "del", "add", "same"]);
  });
});
