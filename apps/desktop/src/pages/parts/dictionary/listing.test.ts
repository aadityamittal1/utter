import { describe, expect, it } from "vitest";
import type { DictEntry, Snippet } from "../../../lib/types";
import { idNum, listDictionary, listSnippets } from "./listing";

const d = (id: string, word: string, heardAs?: string): DictEntry => ({ id, word, heardAs, auto: false });
const ENTRIES = [d("2", "Okafor", "oh car for"), d("10", "tauri"), d("3", "Kubernetes", "cooper netties"), d("1", "Axum")];

describe("idNum", () => {
  it("reads plain and prefixed ids", () => {
    expect(idNum("42")).toBe(42);
    expect(idNum("d_7")).toBe(7);
    expect(idNum("")).toBe(0);
  });
});

describe("listDictionary", () => {
  it("recent sorts by numeric id descending (10 before 9)", () => {
    expect(listDictionary(ENTRIES, "all", "", "recent").map((e) => e.id)).toEqual(["10", "3", "2", "1"]);
  });
  it("az sorts by word, ignoring case", () => {
    expect(listDictionary(ENTRIES, "all", "", "az").map((e) => e.word)).toEqual(["Axum", "Kubernetes", "Okafor", "tauri"]);
  });
  it("filters by tab", () => {
    expect(listDictionary(ENTRIES, "replacements", "", "recent").map((e) => e.id)).toEqual(["3", "2"]);
    expect(listDictionary(ENTRIES, "words", "", "recent").map((e) => e.id)).toEqual(["10", "1"]);
  });
  it("searches word and heard-as", () => {
    expect(listDictionary(ENTRIES, "all", "cooper", "recent").map((e) => e.word)).toEqual(["Kubernetes"]);
    expect(listDictionary(ENTRIES, "all", " AXU ", "recent").map((e) => e.word)).toEqual(["Axum"]);
  });
  it("does not mutate its input", () => {
    const copy = [...ENTRIES];
    listDictionary(ENTRIES, "all", "", "az");
    expect(ENTRIES).toEqual(copy);
  });
});

describe("listSnippets", () => {
  const S: Snippet[] = [
    { id: "1", trigger: "my email", expansion: "a@b.co" },
    { id: "11", trigger: "address", expansion: "1 Main St" },
    { id: "2", trigger: "zoom", expansion: "https://zoom.us/j/1" },
  ];
  it("recent is newest id first, az by trigger", () => {
    expect(listSnippets(S, "", "recent").map((s) => s.id)).toEqual(["11", "2", "1"]);
    expect(listSnippets(S, "", "az").map((s) => s.trigger)).toEqual(["address", "my email", "zoom"]);
  });
  it("searches trigger and expansion", () => {
    expect(listSnippets(S, "zoom.us", "recent").map((s) => s.id)).toEqual(["2"]);
  });
});
