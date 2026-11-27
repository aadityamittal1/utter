import { useCallback, useMemo, useState } from "react";
import { Plus, Search, StickyNote } from "lucide-react";
import { Button, EmptyState, PageHeader, SkeletonRows } from "../components/ui";
import { cn } from "../lib/cn";
import { relativeDay } from "../lib/format";
import { ipc } from "../lib/ipc";
import { toast, useSettings } from "../lib/store";
import type { Note } from "../lib/types";
import { errText, useLoader } from "./parts/dictionary/useLoader";
import { previewLine } from "./parts/notes/autosave";
import { NoteEditor } from "./parts/notes/NoteEditor";

export default function Notes() {
  const dictate = useSettings((s) => s.settings?.shortcuts.dictate?.[0]);
  const { data: notes, setData: setNotes, error: loadError, reload: load } = useLoader<Note[]>(ipc.notesList);
  const [selected, setSelected] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const create = async () => {
    try {
      const n = await ipc.notesCreate();
      setNotes((cur) => [n, ...(cur ?? [])]);
      setSelected(n.id);
      setFresh(n.id);
      setQuery("");
    } catch (e) {
      toast.error(errText(e));
    }
  };

  // Keep list text in sync with saves.
  const saved = useCallback((n: Note) => setNotes((cur) => cur?.map((x) => (x.id === n.id ? n : x)) ?? null), [setNotes]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!notes) return [];
    const list = [...notes].sort((a, b) => b.updatedAt - a.updatedAt);
    return q ? list.filter((n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q)) : list;
  }, [notes, query]);

  // Never show a note the list has filtered out.
  const current = shown.find((n) => n.id === selected) ?? shown[0] ?? null;

  /** Resolves true when deleted. Selection moves to the top note of what is shown. */
  const remove = async (id: string): Promise<boolean> => {
    try {
      await ipc.notesDelete(id);
    } catch (e) {
      toast.error(errText(e));
      return false;
    }
    setSelected(shown.find((n) => n.id !== id)?.id ?? null);
    setNotes((cur) => (cur ?? []).filter((n) => n.id !== id));
    return true;
  };

  return (
    <div>
      <PageHeader
        title="Notes"
        description="A scratchpad next to your dictation. Talk a thought out, tidy it later."
        actions={
          <Button variant="primary" icon={<Plus size={16} strokeWidth={1.5} />} onClick={() => void create()}>
            New note
          </Button>
        }
      />

      {loadError ? (
        <EmptyState title="Couldn't load your notes" description={loadError} action={<Button onClick={() => void load()}>Try again</Button>} />
      ) : !notes ? (
        <SkeletonRows rows={4} />
      ) : notes.length === 0 ? (
        <EmptyState
          icon={<StickyNote size={20} strokeWidth={1.5} />}
          title="No notes yet"
          description="Start a note and dictate straight into it."
          action={
            <Button variant="primary" icon={<Plus size={16} strokeWidth={1.5} />} onClick={() => void create()}>
              New note
            </Button>
          }
        />
      ) : (
        <div className="grid h-[min(640px,calc(100dvh-220px))] min-h-[420px] grid-cols-[272px_1fr] gap-4">
          <div className="flex min-h-0 flex-col">
            <div className="relative pb-3">
              <Search size={16} strokeWidth={1.5} aria-hidden className="pointer-events-none absolute left-3 top-[calc(50%-6px)] -translate-y-1/2 text-faint" />
              <input
                aria-label="Search notes"
                placeholder="Search notes"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-10 w-full rounded-control border border-line bg-surface pl-9 pr-3 text-body placeholder:text-faint transition-colors duration-[167ms] ease-fluent hover:border-line-strong"
              />
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1" aria-label="Notes">
              {shown.length === 0 && <li className="px-3 py-6 text-center text-body text-muted">No notes match.</li>}
              {shown.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(n.id)}
                    aria-current={n.id === current?.id ? "true" : undefined}
                    className={cn("flex w-full flex-col rounded-control px-3 py-2.5 text-left transition-colors duration-[167ms] ease-fluent", n.id === current?.id ? "bg-nav-active" : "hover:bg-row-hover")}
                  >
                    <span className="truncate text-body-strong text-ink">{n.title.trim() || "Untitled note"}</span>
                    <span className="truncate text-caption text-muted">{previewLine(n.body) || "Empty"}</span>
                    <span className="mt-0.5 text-caption text-faint">{relativeDay(n.updatedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="min-h-0 min-w-0 overflow-hidden rounded-card border border-line bg-surface">
            {current ? (
              <NoteEditor key={current.id} note={current} dictateChord={dictate} autoFocus={fresh === current.id} onSaved={saved} onDelete={() => remove(current.id)} />
            ) : (
              <div className="flex h-full items-center justify-center text-body text-muted">Pick a note, or start a new one.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
