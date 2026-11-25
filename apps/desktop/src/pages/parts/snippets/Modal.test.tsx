import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MODAL_FALLBACK_ATTR, Modal } from "./Modal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Modal focus handling", () => {
  let page: HTMLDivElement;
  let host: HTMLDivElement;
  let root: Root;
  let opener: HTMLButtonElement;

  beforeEach(() => {
    page = document.createElement("div");
    host = document.createElement("div");
    document.body.append(page, host);
    opener = document.createElement("button");
    opener.textContent = "open";
    page.appendChild(opener);
    opener.focus();
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    page.remove();
    host.remove();
  });

  const show = (children: React.ReactNode) => act(() => root.render(<Modal title="T" onClose={vi.fn()}>{children}</Modal>));
  const hide = () => act(() => root.render(null));

  it("returns focus to the opener even when a child autofocuses first", () => {
    show(<input aria-label="a" autoFocus />);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("a");
    hide();
    expect(document.activeElement).toBe(opener);
  });

  it("moves focus inside when nothing autofocuses (edit modal), so the Tab trap engages", () => {
    show(<input aria-label="first" />);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("first");
    const dialog = host.querySelector("[role=dialog]")!;
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("falls back to the marked element when the opener is gone", () => {
    const fallback = document.createElement("button");
    fallback.setAttribute(MODAL_FALLBACK_ATTR, "");
    page.appendChild(fallback);
    show(<input aria-label="a" autoFocus />);
    opener.remove(); // e.g. the quick-add chip disappears after saving
    hide();
    expect(document.activeElement).toBe(fallback);
  });

  it("wraps Tab from the last control to the first", () => {
    show(<input aria-label="x" />);
    const buttons = host.querySelectorAll("button");
    buttons[buttons.length - 1].focus();
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    });
    expect(host.querySelector("[role=dialog]")!.contains(document.activeElement)).toBe(true);
  });
});
