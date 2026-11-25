import { useMemo, useState } from "react";
import { ArrowRight, Download, Pencil, Plus, Search, TextCursorInput, Trash2, Upload } from "lucide-react";
import { Button, EmptyState, IconButton, PageHeader, SkeletonRows } from "../components/ui";
import { ipc } from "../lib/ipc";
import { toast } from "../lib/store";
import type { Snippet } from "../lib/types";
import { useLoader } from "./parts/dictionary/useLoader";
import { downloadText, ImportButton } from "./parts/dictionary/fileio";
import { availablePresets } from "./parts/snippets/presets";
import { SnippetModal, type SnippetDraft } from "./parts/snippets/SnippetModal";

const errText = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : "Something went wrong");

export default function Snippets() {
  const { data: items, setData: setItems, error: loadError, reload: load } = useLoader<Snippet[]>(ipc.snippetsList);
  const [draft, setDraft] = useState<SnippetDraft | null>(null);
  const [query, setQuery] = useState("");

  const remove = async (s: Snippet) => {
    try {
      await ipc.snippetsDelete(s.id);
      setItems((cur) => cur?.filter((x) => x.id !== s.id) ?? null);
    } catch (e) {
      toast.error(errText(e));
    }
  };

  const importCsv = async (text: string) => {
    try {
      const n = await ipc.snippetsImportCsv(text);
      toast.success(n === 1 ? "Imported 1 snippet" : `Imported ${n} snippets`);
      await load();
    } catch (e) {
      toast.error(errText(e));
    }
  };

  const exportCsv = async () => {
    try {
      downloadText("utter-snippets.csv", await ipc.snippetsExportCsv());
    } catch (e) {
      toast.error(errText(e));
    }
  };

  const presets = useMemo(() => availablePresets((items ?? []).map((s) => s.trigger)), [items]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!items) return [];
    return q ? items.filter((s) => s.trigger.toLowerCase().includes(q) || s.expansion.toLowerCase().includes(q)) : items;
  }, [items, query]);

  return (
    <div>
      <PageHeader
        title="Snippets"
        description="Say a short phrase, get the full text. Say “my linkedin” and your profile link lands in the box."
        actions={
          <>
            <ImportButton onText={importCsv}>
              <Upload size={14} /> Import
            </ImportButton>
            <Button size="sm" icon={<Download size={14} />} onClick={exportCsv} disabled={!items?.length}>
              Export
            </Button>
            <Button variant="primary" size="sm" icon={<Plus size={15} />} onClick={() => setDraft({ trigger: "", expansion: "" })}>
              New snippet
            </Button>
          </>
        }
      />

      {presets.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-2" role="group" aria-label="Quick add">
          <span className="mr-1 text-[13px] text-muted">Quick add</span>
          {presets.map((p) => (
            <button
              key={p.trigger}
              type="button"
              onClick={() => setDraft({ trigger: p.trigger, expansion: "", placeholder: p.placeholder })}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[13px] text-ink transition-colors hover:border-line-strong hover:bg-hover"
            >
              <Plus size={13} aria-hidden className="text-accent" />
              {p.label}
            </button>
          ))}
        </div>
      )}

      {!!items?.length && (
        <div className="relative mb-4 w-[280px]">
          <Search size={14} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            aria-label="Search snippets"
            placeholder="Search snippets"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-8 w-full rounded-control border border-line bg-surface pl-8 pr-3 text-[13px] placeholder:text-faint hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-0"
          />
        </div>
      )}

      {loadError ? (
        <EmptyState title="Couldn't load your snippets" description={loadError} action={<Button onClick={() => void load()}>Try again</Button>} />
      ) : !items ? (
        <SkeletonRows rows={3} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<TextCursorInput size={18} />}
          title="No snippets yet"
          description="Pick a quick add above, or make your own. Anything you say often is a good snippet."
          action={
            <Button variant="primary" icon={<Plus size={15} />} onClick={() => setDraft({ trigger: "", expansion: "" })}>
              New snippet
            </Button>
          }
        />
      ) : shown.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">No snippets match "{query}".</p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {shown.map((s) => (
            <li key={s.id} className="group relative rounded-card border border-line bg-surface p-4 transition-colors hover:border-line-strong">
              <div className="text-[11px] font-medium text-faint">When I say</div>
              <div className="mt-0.5 truncate text-[15px] font-semibold text-ink">“{s.trigger}”</div>
              <div className="my-2 flex items-center gap-2 text-faint">
                <ArrowRight size={14} aria-hidden className="text-accent" />
                <span className="text-[11px] font-medium">Insert</span>
              </div>
              <p className="line-clamp-3 whitespace-pre-wrap break-words font-mono text-[12.5px] leading-relaxed text-muted">{s.expansion}</p>
              <div className="absolute right-2 top-2 flex opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                <IconButton label={`Edit ${s.trigger}`} onClick={() => setDraft({ id: s.id, trigger: s.trigger, expansion: s.expansion })}>
                  <Pencil size={14} />
                </IconButton>
                <IconButton label={`Delete ${s.trigger}`} onClick={() => void remove(s)}>
                  <Trash2 size={14} />
                </IconButton>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-6 max-w-[70ch] text-[13px] text-muted">
        Utter matches your phrase as whole words, ignoring capitals and punctuation, so “my linkedin” works on its own or in the middle of a sentence. Longer phrases win.
      </p>

      {draft && (
        <SnippetModal
          key={draft.id ?? draft.trigger}
          draft={draft}
          onClose={() => setDraft(null)}
          onSaved={() => {
            setDraft(null);
            void load();
          }}
        />
      )}
    </div>
  );
}
