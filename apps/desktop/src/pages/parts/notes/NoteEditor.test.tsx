import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ipc } from "../../../lib/ipc";
import type { Note } from "../../../lib/types";
import { NoteEditor } from "./NoteEditor";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const note: Note = { id: "n1", title: "Plan", body: "first", updatedAt: 1 };

describe("NoteEditor delete", () => {
  let host: HTMLDivElement;
  let root: Root;
  let update: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    update = vi.spyOn(ipc, "notesUpdate").mockImplementation(async (n: Note) => ({ ...n, updatedAt: 2 }));
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  const type = (value: string) => {
    const ta = host.querySelector("textarea")!;
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    act(() => {
      set.call(ta, value);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const click = async (name: RegExp) => {
    const b = [...host.querySelectorAll("button")].find((x) => name.test(x.getAttribute("aria-label") ?? x.textContent ?? ""))!;
    await act(async () => b.click());
  };
  const status = () => host.querySelector("[role=status]")!.textContent;

  const render = (onDelete: () => Promise<boolean>) =>
    act(() => root.render(<NoteEditor note={note} dictateChord="Ctrl+Win" autoFocus={false} onSaved={vi.fn()} onDelete={onDelete} />));

  it("a failed delete keeps the edit (saved first), resets status and confirmation", async () => {
    const onDelete = vi.fn().mockResolvedValue(false);
    render(onDelete);
    type("first, plus more");
    await click(/Delete this note/);
    await click(/^Delete note$/);

    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0]).toMatchObject({ id: "n1", body: "first, plus more" });
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(status()).toContain("Saved");
    expect(host.querySelector("textarea")!.value).toBe("first, plus more");
    // confirmation is closed again: the plain Delete button is back
    expect(host.querySelector('[aria-label="Delete this note"]')).not.toBeNull();
  });

  it("keeps an unsaved edit pending when both the save and the delete fail, and retries on unmount", async () => {
    update.mockRejectedValue("offline");
    const onDelete = vi.fn().mockResolvedValue(false);
    render(onDelete);
    type("unsaved words");
    await click(/Delete this note/);
    await click(/^Delete note$/);

    expect(status()).toContain("Not saved");
    expect(host.querySelector("textarea")!.value).toBe("unsaved words");

    update.mockImplementation(async (n: Note) => n);
    await act(async () => root.render(null)); // leaving the note flushes the pending edit
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ body: "unsaved words" }));
  });

  it("a successful delete drops the pending edit without saving a deleted note", async () => {
    const onDelete = vi.fn().mockResolvedValue(true);
    render(onDelete);
    await click(/Delete this note/);
    await click(/^Delete note$/);
    expect(onDelete).toHaveBeenCalled();
    await act(async () => root.render(null));
    expect(update).not.toHaveBeenCalled();
  });
});
