import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { buttonByText, dialog, flush, mount, setValue } from "../modalTestUtils";

vi.mock("../../../lib/ipc", () => ({ ipc: { dictionaryAdd: vi.fn(async () => ({})), dictionaryUpdate: vi.fn(async () => ({})) } }));
import { ipc } from "../../../lib/ipc";
import { EntryModal } from "./EntryModal";

describe("EntryModal", () => {
  let unmount: () => void;
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => unmount?.());

  it("opens, adds a word and reports it", async () => {
    const onSaved = vi.fn();
    ({ unmount } = mount(<EntryModal entry={null} onClose={vi.fn()} onSaved={onSaved} />));
    await flush();
    expect(dialog()?.textContent).toContain("Add a word");
    setValue(document.querySelector<HTMLInputElement>("input")!, "Kubernetes");
    await act(async () => buttonByText("Add word")!.click());
    await flush();
    expect(ipc.dictionaryAdd).toHaveBeenCalledWith("Kubernetes", undefined);
    expect(onSaved).toHaveBeenCalled();
  });

  it("editing a learned word saves it as user-made (auto: false)", async () => {
    const onSaved = vi.fn();
    ({ unmount } = mount(<EntryModal entry={{ id: "3", word: "Tauri", heardAs: "tory", auto: true }} onClose={vi.fn()} onSaved={onSaved} />));
    await flush();
    expect(dialog()?.textContent).toContain("Edit word");
    setValue(document.querySelector<HTMLInputElement>("input")!, "Tauri v2");
    await act(async () => buttonByText("Save changes")!.click());
    await flush();
    expect(ipc.dictionaryUpdate).toHaveBeenCalledWith({ id: "3", word: "Tauri v2", heardAs: "tory", auto: false });
    expect(onSaved).toHaveBeenCalled();
  });

  it("closes from Cancel", async () => {
    const onClose = vi.fn();
    ({ unmount } = mount(<EntryModal entry={null} onClose={onClose} onSaved={vi.fn()} />));
    await flush();
    await act(async () => buttonByText("Cancel")!.click());
    expect(onClose).toHaveBeenCalled();
  });
});
