import { describe, expect, it } from "vitest";
import { greeting } from "./greeting";

describe("greeting", () => {
  it("picks by hour", () => {
    expect(greeting(4)).toBe("Good evening");
    expect(greeting(5)).toBe("Good morning");
    expect(greeting(11)).toBe("Good morning");
    expect(greeting(12)).toBe("Good afternoon");
    expect(greeting(16)).toBe("Good afternoon");
    expect(greeting(17)).toBe("Good evening");
    expect(greeting(0)).toBe("Good evening");
  });
});
