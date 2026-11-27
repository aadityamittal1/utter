import { useMemo, useState } from "react";
import { ArrowRight, Download, Pencil, Plus, TextCursorInput, Trash2 } from "lucide-react";
import { Button, EmptyState, IconButton, PageHeader, SkeletonRows } from "../components/ui";
import { ipc } from "../lib/ipc";
import { toast } from "../lib/store";
import type { Snippet } from "../lib/types";
import { errText, useLoader } from "./parts/dictionary/useLoader";
import { downloadText, ImportButton } from "./parts/dictionary/fileio";
import { ListCard, ListRow, ListToolbar, type SortKey } from "./parts/dictionary/ListParts";
import { availablePresets } from "./parts/snippets/presets";
import { SnippetModal, type SnippetDraft } from "./parts/snippets/SnippetModal";

export default function Snippets() {
  const { data: items, setData: setItems, error: loadError, reload: load } = useLoader<Snippet[]>(ipc.snippetsList);
  const [draft, setDraft] = useState<SnippetDraft | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");

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
      if (n === 0) toast.info("No snippets found in that file. Use two columns: trigger, expansion.");
      else toast.success(n === 1 ? "Imported 1 snippet" : `Imported ${n} snippets`);
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

  // Only offer quick adds once we know which triggers already exist.
  const presets = useMemo(() => (items ? availablePresets(items.map((s) => s.trigger)) : []), [items]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = !items ? [] : q ? items.filter((s) => s.trigger.toLowerCase().includes(q) || s.expansion.toLowerCase().includes(q)) : items;
    return sort === "az" ? [...list].sort((a, b) => a.trigger.localeCompare(b.trigger, undefined, { sensitivity: "base" })) : list;
  }, [items, query, sort]);

  const add = () => setDraft({ trigger: "", expansion: "" });

  return (
    <div>
      <PageHeader
        title="Snippets"
        actions={
          <>
            <ImportButton onText={importCsv}>Import</ImportButton>
            <Button variant="primary" onClick={add}>
              Add new
            </Button>
          </>
        }
      />

      <ListToolbar
        query={query}
        onQuery={setQuery}
        sort={sort}
        onSort={setSort}
        searchLabel="Search snippets"
        disabled={!items?.length}
        extra={
          <IconButton label="Export CSV" disabled={!items?.length} onClick={exportCsv}>
            <Download size={16} strokeWidth={1.5} />
          </IconButton>
        }
      />

      {loadError ? (
        <div className="mt-6">
          <EmptyState title="Couldn't load your snippets" description={loadError} action={<Button onClick={() => void load()}>Try again</Button>} />
        </div>
      ) : !items ? (
        <div className="mt-6">
          <SkeletonRows rows={3} />
        </div>
      ) : items.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={<TextCursorInput size={20} strokeWidth={1.5} />}
            title="No snippets yet"
            description="Pick a quick add below, or make your own. Anything you say often is a good snippet."
            action={
              <Button variant="primary" onClick={add}>
                Add new
              </Button>
            }
          />
        </div>
      ) : shown.length === 0 ? (
        <p className="py-14 text-center text-body text-muted">No snippets match “{query.trim()}”.</p>
      ) : (
        <ListCard>
          {shown.map((s) => (
            <ListRow
              key={s.id}
              onActivate={() => setDraft({ id: s.id, trigger: s.trigger, expansion: s.expansion })}
              actions={
                <>
                  <IconButton label={`Edit ${s.trigger}`} onClick={() => setDraft({ id: s.id, trigger: s.trigger, expansion: s.expansion })}>
                    <Pencil size={16} strokeWidth={1.5} />
                  </IconButton>
                  <IconButton label={`Delete ${s.trigger}`} onClick={() => void remove(s)}>
                    <Trash2 size={16} strokeWidth={1.5} />
                  </IconButton>
                </>
              }
            >
              <div className="flex min-w-0 items-center gap-2 text-body text-ink">
                <span className="shrink-0">{s.trigger}</span>
                <ArrowRight size={16} strokeWidth={1.5} aria-label="inserts" className="shrink-0 text-faint" />
                <span className="truncate text-muted">{s.expansion.replace(/\s+/g, " ")}</span>
              </div>
            </ListRow>
          ))}
        </ListCard>
      )}

      {presets.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center gap-2" role="group" aria-label="Quick add">
          <span className="mr-1 text-caption text-muted">Quick add</span>
          {presets.map((p) => (
            <button
              key={p.trigger}
              type="button"
              onClick={() => setDraft({ trigger: p.trigger, expansion: "", placeholder: p.placeholder })}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-body text-ink transition-colors duration-[var(--dur-fast)] ease-fluent hover:border-line-strong hover:bg-hover"
            >
              <Plus size={16} strokeWidth={1.5} aria-hidden className="text-ember-text" />
              {p.label}
            </button>
          ))}
        </div>
      )}

      <p className="mt-6 max-w-[70ch] text-caption text-muted">
        Utter matches your phrase as whole words, ignoring capitals and punctuation, so “my linkedin” works on its own or in the middle of a sentence. Longer phrases win.
      </p>

      {draft && (
        <SnippetModal
          key={draft.id ?? draft.trigger}
          draft={draft}
          onClose={() => setDraft(null)}
          onSaved={async () => {
            await load();
            setDraft(null);
          }}
        />
      )}
    </div>
  );
}
