import { describe, expect, it } from "vitest";
import { CATEGORIES, STYLE_KINDS } from "../../../lib/types";
import { allowedStyles, disabledReason, isStyleAllowed, renderExample } from "./examples";

describe("renderExample", () => {
  it("renders distinct text for every style", () => {
    for (const c of CATEGORIES) {
      const out = STYLE_KINDS.map((s) => renderExample(s, c));
      expect(new Set(out).size).toBe(4);
    }
  });
  it("formal is polite, casual is friendly, excited has exclamation", () => {
    expect(renderExample("formal", "email")).toBe("Hello Priya, could you please send me the contract by Friday? Thank you.");
    expect(renderExample("casual", "email")).toBe("Hey Priya, can you send me the contract by Friday? Thanks!");
    expect(renderExample("excited", "email")).toMatch(/!!$/);
  });
  it("very casual is lowercase with no end punctuation", () => {
    const t = renderExample("veryCasual", "personalChat");
    expect(t).toBe(t.toLowerCase());
    expect(t).toBe("hey sam can you grab me a coffee on your way thx");
  });
  it("omits the greeting name when the category has none", () => {
    expect(renderExample("formal", "aiPrompt")).toBe("Hello, could you please summarize this thread in three bullets? Thank you.");
  });
});

describe("style availability", () => {
  it("very casual only on personal chat", () => {
    expect(CATEGORIES.filter((c) => isStyleAllowed(c, "veryCasual"))).toEqual(["personalChat"]);
  });
  it("excited everywhere except personal chat", () => {
    expect(CATEGORIES.filter((c) => !isStyleAllowed(c, "excited"))).toEqual(["personalChat"]);
  });
  it("formal and casual always allowed", () => {
    for (const c of CATEGORIES) {
      expect(isStyleAllowed(c, "formal")).toBe(true);
      expect(isStyleAllowed(c, "casual")).toBe(true);
    }
  });
  it("lists allowed styles and reasons", () => {
    expect(allowedStyles("personalChat")).toEqual(["formal", "casual", "veryCasual"]);
    expect(allowedStyles("email")).toEqual(["formal", "casual", "excited"]);
    expect(disabledReason("email", "veryCasual")).toMatch(/Personal chat/);
    expect(disabledReason("email", "formal")).toBeNull();
  });
});
