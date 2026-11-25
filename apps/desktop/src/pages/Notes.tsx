import { useCallback, useMemo, useState } from "react";
import { Plus, Search, StickyNote } from "lucide-react";
import { Button, EmptyState, PageHeader, SkeletonRows } from "../components/ui";
import { cn } from "../lib/cn";
import { relativeDay } from "../lib/format";
import { ipc } from "../lib/ipc";
import { toast, useSettings } from "../lib/store";
import type { Note } from "../lib/types";
import { useLoader } from "./parts/dictionary/useLoader";
import { previewLine } from "./parts/notes/autosave";
import { NoteEditor } from "./parts/notes/NoteEditor";

const errText = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : "Something went wrong");

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

  const remove = async (id: string) => {
    try {
      await ipc.notesDelete(id);
      setNotes((cur) => (cur ?? []).filter((n) => n.id !== id));
      setSelected(null);
    } catch (e) {
      toast.error(errText(e));
    }
  };

  // Keep list text in sync with saves without reordering under the user's cursor.
  const saved = useCallback((n: Note) => setNotes((cur) => cur?.map((x) => (x.id === n.id ? n : x)) ?? null), [setNotes]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!notes) return [];
    const list = [...notes].sort((a, b) => b.updatedAt - a.updatedAt);
    return q ? list.filter((n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q)) : list;
  }, [notes, query]);

  const current = notes?.find((n) => n.id === selected) ?? notes?.[0] ?? null;

  return (
    <div>
      <PageHeader
        title="Notes"
        description="A scratchpad that lives next to your dictation. Talk a thought out, tidy it later."
        actions={
          <Button variant="primary" size="sm" icon={<Plus size={15} />} onClick={() => void create()}>
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
          icon={<StickyNote size={18} />}
          title="No notes yet"
          description="Start a note and dictate straight into it."
          action={
            <Button variant="primary" icon={<Plus size={15} />} onClick={() => void create()}>
              New note
            </Button>
          }
        />
      ) : (
        <div className="grid h-[min(620px,calc(100dvh-220px))] min-h-[420px] grid-cols-[260px_1fr] overflow-hidden rounded-card border border-line bg-surface">
          <div className="flex min-h-0 flex-col border-r border-line">
            <div className="relative border-b border-line p-2.5">
              <Search size={14} aria-hidden className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-faint" />
              <input
                aria-label="Search notes"
                placeholder="Search notes"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-8 w-full rounded-control border border-line bg-bg pl-8 pr-3 text-[13px] placeholder:text-faint hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-0"
              />
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto p-1.5" aria-label="Notes">
              {shown.length === 0 && <li className="px-3 py-6 text-center text-[13px] text-muted">No notes match.</li>}
              {shown.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(n.id)}
                    aria-current={n.id === current?.id ? "true" : undefined}
                    className={cn("flex w-full flex-col rounded-control px-3 py-2 text-left transition-colors", n.id === current?.id ? "bg-muted-surface" : "hover:bg-hover")}
                  >
                    <span className="truncate text-sm font-medium text-ink">{n.title.trim() || "Untitled note"}</span>
                    <span className="truncate text-xs text-muted">{previewLine(n.body) || "Empty"}</span>
                    <span className="mt-0.5 text-[11px] text-faint">{relativeDay(n.updatedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="min-h-0 min-w-0">
            {current ? (
              <NoteEditor key={current.id} note={current} dictateChord={dictate} autoFocus={fresh === current.id} onSaved={saved} onDelete={() => void remove(current.id)} />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted">Pick a note, or start a new one.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
