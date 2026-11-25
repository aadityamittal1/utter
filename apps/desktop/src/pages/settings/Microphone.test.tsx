import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

const calls: string[] = [];
let resolveStart: () => void = () => undefined;
vi.mock("../../lib/ipc", () => ({
  isTauri: () => false,
  on: vi.fn(async () => () => undefined),
  ipc: {
    listMicrophones: vi.fn(async () => ["Mic A"]),
    startMicTest: vi.fn(() => {
      calls.push("start");
      return new Promise<void>((r) => (resolveStart = r));
    }),
    stopMicTest: vi.fn(async () => void calls.push("stop")),
  },
}));
vi.mock("./parts", async () => {
  const actual = await vi.importActual<typeof import("./parts")>("./parts");
  return {
    ...actual,
    WithSettings: ({ children }: { children: (s: unknown, u: () => Promise<void>) => React.ReactNode }) =>
      children({ microphone: null }, async () => undefined),
  };
});

import Microphone from "./Microphone";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(<Microphone />));
  return { host, root };
}
const startBtn = (host: HTMLElement) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Test microphone"))!;

describe("Microphone test cleanup", () => {
  it("stops the mic when unmounted while the start is still pending", async () => {
    calls.length = 0;
    const { host, root } = mount();
    await act(async () => startBtn(host).click());
    expect(calls).toEqual(["start"]);
    act(() => root.unmount());
    expect(calls).toEqual(["start", "stop"]);
    await act(async () => resolveStart()); // start resolves after unmount
    expect(calls.filter((c) => c === "stop").length).toBeGreaterThanOrEqual(1);
  });

  it("stops the mic when the window becomes hidden", async () => {
    calls.length = 0;
    const { host, root } = mount();
    await act(async () => {
      startBtn(host).click();
    });
    await act(async () => resolveStart());
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    await act(async () => void document.dispatchEvent(new Event("visibilitychange")));
    expect(calls).toContain("stop");
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    act(() => root.unmount());
  });
});
