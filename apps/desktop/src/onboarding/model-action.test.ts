import { describe, expect, it } from "vitest";
import { modelAction } from "./helpers";

describe("modelAction", () => {
  const m = (id: string, downloaded: boolean, active = false, recommended = false) => ({ id, downloaded, active, recommended });
  it("activates a downloaded, inactive choice", () => {
    expect(modelAction([m("a", true, true), m("b", true)], "b")).toEqual({ kind: "activate", id: "b" });
  });
  it("is ready when the choice is active", () => {
    expect(modelAction([m("a", true, true)], "a")).toEqual({ kind: "ready", id: "a" });
  });
  it("is pending while the choice downloads", () => {
    expect(modelAction([m("a", true, true), m("b", false)], "b")).toEqual({ kind: "pending", id: "b" });
  });
  it("falls back to a downloaded recommended model when nothing is active", () => {
    expect(modelAction([m("a", false), m("b", true, false, true)], null)).toEqual({ kind: "activate", id: "b" });
    expect(modelAction([m("a", false)], null)).toEqual({ kind: "none" });
  });
});
