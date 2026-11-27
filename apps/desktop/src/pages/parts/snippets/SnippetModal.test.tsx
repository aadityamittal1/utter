import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { buttonByText, dialog, flush, mount, setValue } from "../modalTestUtils";

vi.mock("../../../lib/ipc", () => ({ ipc: { snippetsAdd: vi.fn(async () => ({})), snippetsUpdate: vi.fn(async () => ({})) } }));
import { ipc } from "../../../lib/ipc";
import { SnippetModal } from "./SnippetModal";

describe("SnippetModal", () => {
  let unmount: () => void;
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => unmount?.());

  it("opens, saves a new snippet and reports it", async () => {
    const onSaved = vi.fn();
    ({ unmount } = mount(<SnippetModal draft={{ trigger: "", expansion: "" }} onClose={vi.fn()} onSaved={onSaved} />));
    await flush();
    expect(dialog()?.textContent).toContain("New snippet");
    setValue(document.querySelector<HTMLInputElement>("input")!, "my site");
    setValue(document.querySelector<HTMLTextAreaElement>("textarea")!, "https://example.com");
    await act(async () => buttonByText("Add snippet")!.click());
    await flush();
    expect(ipc.snippetsAdd).toHaveBeenCalledWith("my site", "https://example.com");
    expect(onSaved).toHaveBeenCalled();
  });

  it("shows a validation message and does not save an empty snippet", async () => {
    ({ unmount } = mount(<SnippetModal draft={{ trigger: "", expansion: "" }} onClose={vi.fn()} onSaved={vi.fn()} />));
    await flush();
    await act(async () => buttonByText("Add snippet")!.click());
    await flush();
    expect(ipc.snippetsAdd).not.toHaveBeenCalled();
    expect(dialog()?.querySelector("[role=alert]")?.textContent).toMatch(/phrase/);
  });

  it("closes from Cancel", async () => {
    const onClose = vi.fn();
    ({ unmount } = mount(<SnippetModal draft={{ id: "1", trigger: "a", expansion: "b" }} onClose={onClose} onSaved={vi.fn()} />));
    await flush();
    expect(dialog()?.textContent).toContain("Edit snippet");
    await act(async () => buttonByText("Cancel")!.click());
    expect(onClose).toHaveBeenCalled();
  });
});
