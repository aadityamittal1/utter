import { useEffect, useRef, useState } from "react";
import { Check, Trash2 } from "lucide-react";
import { Button, Chord } from "../../../components/ui";
import { ipc } from "../../../lib/ipc";
import { formatChord } from "../../../lib/format";
import { toast } from "../../../lib/store";
import type { Note } from "../../../lib/types";
import { errText } from "../dictionary/useLoader";
import { createAutosaver } from "./autosave";

type Status = "saved" | "saving" | "error";

/**
 * Edits one note. Mount it with `key={note.id}`: switching notes (or leaving
 * the page) unmounts it, and the cleanup flushes any pending edit first.
 * `onDelete` resolves true when the note was deleted; on false the editor stays,
 * keeping every edit.
 */
export function NoteEditor({
  note,
  dictateChord,
  autoFocus,
  onSaved,
  onDelete,
}: {
  note: Note;
  dictateChord: string | undefined;
  autoFocus: boolean;
  onSaved: (n: Note) => void;
  onDelete: () => Promise<boolean>;
}) {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [status, setStatus] = useState<Status>("saved");
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const [saver] = useState(() =>
    createAutosaver<Note>(async (n) => {
      setStatus("saving");
      try {
        const saved = await ipc.notesUpdate(n);
        onSaved(saved);
        setStatus("saved");
      } catch (e) {
        setStatus("error");
        toast.error(errText(e, "Couldn't save your note"));
        throw e; // keeps the edit pending for the next edit or flush
      }
    }, 500),
  );

  useEffect(() => () => void saver.flush(), [saver]);

  useEffect(() => {
    if (autoFocus) bodyRef.current?.focus();
  }, [autoFocus]);

  const edit = (next: { title?: string; body?: string }) => {
    const t = next.title ?? title;
    const b = next.body ?? body;
    setTitle(t);
    setBody(b);
    setStatus("saving");
    saver.schedule({ ...note, title: t, body: b });
  };

  const remove = async () => {
    setDeleting(true);
    await saver.flush(); // pending edit is saved before anything is removed
    const ok = await onDelete();
    if (ok) {
      saver.cancel(); // only now is the edit meaningless
      return;
    }
    setDeleting(false);
    setConfirming(false);
    setStatus(saver.hasPending() ? "error" : "saved");
  };

  const words = body.trim() ? body.trim().split(/\s+/).length : 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-line px-6 py-3">
        <input
          aria-label="Note title"
          value={title}
          onChange={(e) => edit({ title: e.target.value })}
          placeholder="Untitled note"
          className="min-w-0 flex-1 bg-transparent font-display text-[26px] leading-tight text-ink placeholder:text-faint focus-visible:outline-none"
        />
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted" role="status" aria-live="polite">
          {status === "saved" && (
            <>
              <Check size={13} aria-hidden className="text-success" /> Saved
            </>
          )}
          {status === "saving" && "Saving..."}
          {status === "error" && <span className="text-danger">Not saved</span>}
        </span>
        {confirming ? (
          <span className="flex shrink-0 items-center gap-1.5">
            <Button size="sm" variant="danger" loading={deleting} onClick={() => void remove()}>
              Delete note
            </Button>
            <Button size="sm" variant="ghost" disabled={deleting} onClick={() => setConfirming(false)}>
              Keep
            </Button>
          </span>
        ) : (
          <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={() => setConfirming(true)} aria-label="Delete this note">
            Delete
          </Button>
        )}
      </div>
      <textarea
        ref={bodyRef}
        aria-label="Note body"
        value={body}
        onChange={(e) => edit({ body: e.target.value })}
        placeholder="Start typing, or hold the dictate keys and talk."
        className="min-h-0 flex-1 resize-none bg-transparent px-6 py-5 text-[15px] leading-[1.7] text-ink placeholder:text-faint focus-visible:outline-none"
      />
      <div className="flex items-center justify-between border-t border-line px-6 py-2.5 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          Hold <Chord chord={formatChord(dictateChord)} /> to dictate here
        </span>
        <span className="num">
          {words} {words === 1 ? "word" : "words"}
        </span>
      </div>
    </div>
  );
}
