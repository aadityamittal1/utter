import { useMemo, useState } from "react";
import { ArrowRight, BookA, Download, Pencil, Sparkles, Trash2 } from "lucide-react";
import { Button, EmptyState, IconButton, PageHeader, SkeletonRows } from "../components/ui";
import { ipc } from "../lib/ipc";
import { toast } from "../lib/store";
import type { DictEntry } from "../lib/types";
import { errText, useLoader } from "./parts/dictionary/useLoader";
import { downloadText, ImportButton } from "./parts/dictionary/fileio";
import { EntryModal } from "./parts/dictionary/EntryModal";
import { ListCard, ListRow, ListToolbar, PageTabs } from "./parts/dictionary/ListParts";
import { listDictionary, type DictTab, type SortKey } from "./parts/dictionary/listing";

type Tab = DictTab;
const TABS = [
  { id: "all", label: "All" },
  { id: "replacements", label: "Replacements" },
  { id: "words", label: "Words" },
];

export default function Dictionary() {
  const { data: entries, setData: setEntries, error: loadError, reload: load } = useLoader<DictEntry[]>(ipc.dictionaryList);
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  // undefined = closed, null = adding, entry = editing
  const [editing, setEditing] = useState<DictEntry | null | undefined>(undefined);

  const remove = async (id: string) => {
    try {
      await ipc.dictionaryDelete(id);
      setEntries((cur) => cur?.filter((d) => d.id !== id) ?? null);
    } catch (e) {
      toast.error(errText(e));
    }
  };

  const importCsv = async (text: string) => {
    try {
      const n = await ipc.dictionaryImportCsv(text);
      if (n === 0) toast.info("No words found in that file. Use two columns: word, heard as.");
      else toast.success(n === 1 ? "Imported 1 word" : `Imported ${n} words`);
      await load();
    } catch (e) {
      toast.error(errText(e));
    }
  };

  const exportCsv = async () => {
    try {
      downloadText("utter-dictionary.csv", await ipc.dictionaryExportCsv());
    } catch (e) {
      toast.error(errText(e));
    }
  };

  const shown = useMemo(() => (entries ? listDictionary(entries, tab, query, sort) : []), [entries, tab, query, sort]);

  const empty = entries?.length === 0;

  return (
    <div>
      <PageHeader
        title="Dictionary"
        actions={
          <>
            <ImportButton onText={importCsv}>Import</ImportButton>
            <Button variant="primary" onClick={() => setEditing(null)}>
              Add new
            </Button>
          </>
        }
      />

      <ListToolbar
        tabs={<PageTabs label="Dictionary filter" tabs={TABS} value={tab} onChange={(t) => setTab(t as Tab)} />}
        query={query}
        onQuery={setQuery}
        sort={sort}
        onSort={setSort}
        searchLabel="Search dictionary"
        disabled={!entries?.length}
        extra={
          <IconButton label="Export CSV" disabled={!entries?.length} onClick={exportCsv}>
            <Download size={16} strokeWidth={1.5} />
          </IconButton>
        }
      />

      {loadError ? (
        <div className="mt-6">
          <EmptyState title="Couldn't load your dictionary" description={loadError} action={<Button onClick={() => void load()}>Try again</Button>} />
        </div>
      ) : !entries ? (
        <div className="mt-6">
          <SkeletonRows rows={4} />
        </div>
      ) : empty ? (
        <div className="mt-6">
          <EmptyState
            icon={<BookA size={20} strokeWidth={1.5} />}
            title="No words yet"
            description="Add a name or term Utter should always spell your way. It also learns words when you fix them in History."
            action={
              <Button variant="primary" onClick={() => setEditing(null)}>
                Add new
              </Button>
            }
          />
        </div>
      ) : shown.length === 0 ? (
        <p className="py-14 text-center text-body text-muted">{query.trim() ? `No words match “${query.trim()}”.` : tab === "replacements" ? "No replacements yet. Add a word with a misspelling to fix." : "No plain words yet."}</p>
      ) : (
        <ListCard>
          {shown.map((d) => (
            <ListRow
              key={d.id}
              onActivate={() => setEditing(d)}
              actions={
                <>
                  <IconButton label={`Edit ${d.word}`} onClick={() => setEditing(d)}>
                    <Pencil size={16} strokeWidth={1.5} />
                  </IconButton>
                  <IconButton label={`Delete ${d.word}`} onClick={() => void remove(d.id)}>
                    <Trash2 size={16} strokeWidth={1.5} />
                  </IconButton>
                </>
              }
            >
              <div className="flex min-w-0 items-center gap-2 text-body text-ink">
                {d.heardAs && (
                  <>
                    <span className="truncate text-muted">{d.heardAs}</span>
                    <ArrowRight size={16} strokeWidth={1.5} role="img" aria-label="becomes" className="shrink-0 text-faint" />
                  </>
                )}
                <span className="truncate">{d.word}</span>
                {d.auto && (
                  <span title="Learned from your edits" className="shrink-0 text-faint">
                    <Sparkles size={16} strokeWidth={1.5} aria-hidden />
                    <span className="sr-only">Learned from your edits</span>
                  </span>
                )}
              </div>
            </ListRow>
          ))}
        </ListCard>
      )}

      {editing !== undefined && (
        <EntryModal
          key={editing?.id ?? "new"}
          entry={editing}
          onClose={() => setEditing(undefined)}
          onSaved={async () => {
            await load();
            setEditing(undefined);
          }}
        />
      )}
    </div>
  );
}
