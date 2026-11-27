import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { buttonByText, dialog, flush, mount, setValue } from "../modalTestUtils";

vi.mock("../../../lib/ipc", () => ({
  isTauri: () => false,
  on: async () => () => undefined,
  ipc: { transformsAdd: vi.fn(async () => ({})), transformsUpdate: vi.fn(async () => ({})), startShortcutCapture: vi.fn(), stopShortcutCapture: vi.fn(async () => undefined) },
}));
import { ipc } from "../../../lib/ipc";
import { TransformModal } from "./cards";

describe("TransformModal", () => {
  let unmount: () => void;
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => unmount?.());

  it("opens, creates a transform and reports it", async () => {
    const onSaved = vi.fn();
    ({ unmount } = mount(<TransformModal initial={{ name: "", instruction: "" }} onClose={vi.fn()} onSaved={onSaved} />));
    await flush();
    expect(dialog()?.textContent).toContain("Create a transform");
    setValue(document.querySelector<HTMLInputElement>("input")!, "Shorter");
    setValue(document.querySelector<HTMLTextAreaElement>("textarea")!, "Cut it down.");
    await act(async () => buttonByText("Add transform")!.click());
    await flush();
    expect(ipc.transformsAdd).toHaveBeenCalledWith("Shorter", "Cut it down.", undefined);
    expect(onSaved).toHaveBeenCalled();
  });

  it("built-ins show their instruction read-only and offer no delete", async () => {
    ({ unmount } = mount(
      <TransformModal initial={{ id: "tf_polish", name: "Polish", instruction: "Fix grammar.", shortcut: "Alt+Shift+1", builtin: true }} onClose={vi.fn()} onSaved={vi.fn()} onDelete={undefined} />,
    ));
    await flush();
    expect(dialog()?.textContent).toContain("Fix grammar.");
    expect(dialog()?.querySelector("textarea")).toBeNull();
    expect(buttonByText("Delete")).toBeUndefined();
  });

  it("closes from Cancel and deletes through onDelete", async () => {
    const onClose = vi.fn();
    const onDelete = vi.fn();
    ({ unmount } = mount(<TransformModal initial={{ id: "tf_x", name: "X", instruction: "Do x." }} onClose={onClose} onSaved={vi.fn()} onDelete={onDelete} />));
    await flush();
    await act(async () => buttonByText("Delete")!.click());
    expect(onDelete).toHaveBeenCalled();
    await act(async () => buttonByText("Cancel")!.click());
    expect(onClose).toHaveBeenCalled();
  });

  it("Esc right after starting a shortcut recording does not close the dialog", async () => {
    const onClose = vi.fn();
    ({ unmount } = mount(<TransformModal initial={{ id: "tf_x", name: "X", instruction: "Do x." }} onClose={onClose} onSaved={vi.fn()} />));
    await flush();
    const rec = dialog()!.querySelector<HTMLButtonElement>("button[aria-label*=\"shortcut\"]")!;
    await act(async () => rec.click());
    await act(async () => {
      rec.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog()).not.toBeNull();
  });
});
