import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventMap, EventName, PillAction, PillState } from "../lib/types";

const h = vi.hoisted(() => ({
  pillAction: vi.fn<(a: string) => Promise<void>>(),
  handlers: new Map<string, (p: unknown) => void>(),
}));

vi.mock("../lib/ipc", () => ({
  ipc: {
    pillAction: h.pillAction,
    getSettings: () => Promise.resolve({ shortcuts: { dictate: ["Ctrl+Win"] } }),
  },
  on: (event: string, cb: (p: unknown) => void) => {
    h.handlers.set(event, cb);
    return Promise.resolve(() => h.handlers.delete(event));
  },
}));

import { Pill, PillView } from "./Pill";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const base = { mode: "dictate", elapsedMs: 0 };
const idle: PillState = { ...base, state: "idle" };
const listening: PillState = { ...base, state: "listening", elapsedMs: 3000 };
const locked: PillState = { ...base, state: "locked", mode: "handsFree", elapsedMs: 3000 };

function html(state: PillState, extra: Partial<Parameters<typeof PillView>[0]> = {}): string {
  return renderToStaticMarkup(<PillView state={state} levelsRef={{ current: [] }} {...extra} />);
}

const err: PillState = { state: "error", mode: "dictate", elapsedMs: 0, message: "Transcription failed" };

describe("pill Retry chip", () => {
  it("is shown when the error is retryable", () => {
    expect(html({ ...err, retryable: true })).toContain("Retry");
  });
  it("is hidden when retryable is false or absent", () => {
    expect(html({ ...err, retryable: false })).not.toContain("Retry");
    expect(html(err)).not.toContain("Retry");
  });
  it("still shows the error message", () => {
    expect(html(err)).toContain("Transcription failed");
  });
});

describe("pill markup", () => {
  it("draws nine bars while listening", () => {
    expect(html(listening).match(/class="pill-bar"/g)).toHaveLength(9);
  });
  it("sets the contract size as CSS variables", () => {
    expect(html(idle)).toContain("--w:44px");
    expect(html(idle)).toContain("--h:8px");
    expect(html(locked)).toContain("--w:212px");
    expect(html(err)).toContain("--w:280px");
    expect(html(idle, { menuOpen: true })).toContain("--w:336px");
  });
  it("shows the dictate chord as keycaps on hover, with a fallback", () => {
    const withChord = html(idle, { hover: true, chord: "Ctrl+Win" });
    expect(withChord).toContain(">Ctrl<");
    expect(withChord).toContain(">Win<");
    expect(withChord).toContain("to dictate");
    expect(html(idle, { hover: true })).toContain("Click to dictate");
  });
  it("shows the remaining time from 19 minutes", () => {
    expect(html({ ...listening, elapsedMs: 19 * 60_000 + 18_000 })).toContain("0:42 left");
  });
});

describe("pill click routing", () => {
  let host: HTMLDivElement;
  let root: Root;
  const onAction = vi.fn<(a: PillAction) => void>();

  function mount(state: PillState) {
    act(() => root.render(<PillView state={state} levelsRef={{ current: [] }} onAction={onAction} />));
  }
  const capsule = () => host.querySelector<HTMLElement>(".pill-capsule")!;
  const click = (el: Element) => act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));

  beforeEach(() => {
    onAction.mockClear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("starts from idle", () => {
    mount(idle);
    click(capsule());
    expect(onAction.mock.calls).toEqual([["start"]]);
  });
  it("toggles while listening", () => {
    mount(listening);
    click(capsule());
    expect(onAction.mock.calls).toEqual([["toggle"]]);
  });
  it("toggles on the locked body but stop and cancel do not also toggle", () => {
    mount(locked);
    click(capsule());
    expect(onAction.mock.calls).toEqual([["toggle"]]);
    onAction.mockClear();
    click(host.querySelector(".pill-btn[data-tone='stop']")!);
    expect(onAction.mock.calls).toEqual([["stop"]]);
    onAction.mockClear();
    click(host.querySelector(".pill-btn[data-tone='muted']")!);
    expect(onAction.mock.calls).toEqual([["cancel"]]);
  });
  it("does nothing on thinking, and Retry does not bubble", () => {
    mount({ ...base, state: "thinking" });
    click(capsule());
    expect(onAction).not.toHaveBeenCalled();
    mount({ ...err, retryable: true });
    click(host.querySelector(".pill-chip")!);
    expect(onAction.mock.calls).toEqual([["retry"]]);
  });
});

describe("pill menu latch (container)", () => {
  let host: HTMLDivElement;
  let root: Root;
  const sent = () => h.pillAction.mock.calls.map((c) => c[0]);
  const emit = <E extends EventName>(e: E, p: EventMap[E]) => act(() => h.handlers.get(e)?.(p));
  const rightClick = () =>
    act(() => {
      host.querySelector(".pill-root")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    });

  beforeEach(async () => {
    vi.useFakeTimers();
    h.pillAction.mockReset();
    h.pillAction.mockResolvedValue(undefined);
    h.handlers.clear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(<Pill />));
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it("sends menuOpen on right-click and menuClose on Esc", () => {
    rightClick();
    expect(sent()).toEqual(["menuOpen"]);
    expect(host.querySelector(".pill-menu")).not.toBeNull();
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(sent()).toEqual(["menuOpen", "menuClose"]);
  });
  it("sends menuClose on window blur", () => {
    rightClick();
    act(() => window.dispatchEvent(new Event("blur")));
    expect(sent()).toEqual(["menuOpen", "menuClose"]);
  });
  it("sends menuClose after 3 s idle", () => {
    rightClick();
    act(() => vi.advanceTimersByTime(3100));
    expect(sent()).toEqual(["menuOpen", "menuClose"]);
  });
  it("sends the item action, then menuClose, when an item is clicked", () => {
    rightClick();
    act(() => host.querySelectorAll<HTMLElement>(".pill-menu-item")[1].click());
    expect(sent()).toEqual(["menuOpen", "openHub", "menuClose"]);
  });
  it("sends menuClose when the close button is clicked", () => {
    rightClick();
    act(() => host.querySelector<HTMLElement>(".pill-menu-close")!.click());
    expect(sent()).toEqual(["menuOpen", "menuClose"]);
  });
  it("sends menuClose on a pill state change", () => {
    rightClick();
    emit("pill://state", { ...base, state: "listening", elapsedMs: 0 });
    expect(sent()).toEqual(["menuOpen", "menuClose"]);
    expect(host.querySelector(".pill-menu")).toBeNull();
  });
  it("sends menuClose on unmount", () => {
    rightClick();
    act(() => root.unmount());
    expect(sent()).toEqual(["menuOpen", "menuClose"]);
    root = createRoot(host); // so afterEach can unmount
  });
  it("does not open the menu while thinking", () => {
    emit("pill://state", { ...base, state: "thinking" });
    rightClick();
    expect(sent()).toEqual([]);
  });
  it("grows on pill://hover and shows the chord from settings", async () => {
    await act(async () => undefined);
    emit("pill://hover", { hover: true });
    expect(host.querySelector(".pill-capsule")?.getAttribute("data-view")).toBe("hover");
    expect(host.textContent).toContain("Ctrl");
    expect(host.textContent).toContain("to dictate");
    emit("pill://hover", { hover: false });
    expect(host.querySelector(".pill-capsule")?.getAttribute("data-view")).toBe("idle");
  });
});
