import { describe, expect, it } from "vitest";
import { createLatestGuard } from "./latest";

describe("createLatestGuard", () => {
  it("only the newest request is current", () => {
    const g = createLatestGuard();
    const a = g.next();
    expect(a()).toBe(true);
    const b = g.next();
    expect(a()).toBe(false);
    expect(b()).toBe(true);
  });
});
