import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

const calls: string[] = [];
vi.mock("../../lib/ipc", () => ({
  isTauri: () => true,
  on: vi.fn(async () => () => calls.push("unlisten")),
  ipc: {
    startShortcutCapture: vi.fn(async () => void calls.push("start")),
    stopShortcutCapture: vi.fn(async () => void calls.push("stop")),
  },
}));

import { ShortcutRecorder } from "./ShortcutRecorder";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ShortcutRecorder (app mode)", () => {
  it("listens before starting capture and always stops capture on unmount", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<ShortcutRecorder value="Ctrl+Win" onChange={() => undefined} label="Dictate" />));
    await act(async () => host.querySelector("button")!.click());
    await act(async () => undefined);
    expect(calls.indexOf("start")).toBeGreaterThanOrEqual(0);
    act(() => root.unmount());
    expect(calls).toContain("stop");
    expect(calls).toContain("unlisten");
    host.remove();
  });
});
