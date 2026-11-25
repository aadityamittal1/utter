import { useMemo, useState } from "react";
import { BookA, Download, Search, Sparkles, Trash2, Upload } from "lucide-react";
import { Button, EmptyState, IconButton, Input, PageHeader, SkeletonRows, Switch } from "../components/ui";
import { ipc } from "../lib/ipc";
import { toast } from "../lib/store";
import type { DictEntry } from "../lib/types";
import { errText, useLoader } from "./parts/dictionary/useLoader";
import { downloadText, ImportButton } from "./parts/dictionary/fileio";
import { countLabel, validateEntry, WORD_MAX, type EntryErrors } from "./parts/dictionary/validate";

export default function Dictionary() {
  const { data: entries, setData: setEntries, error: loadError, reload: load } = useLoader<DictEntry[]>(ipc.dictionaryList);
  const [query, setQuery] = useState("");
  const [word, setWord] = useState("");
  const [fix, setFix] = useState(false);
  const [heard, setHeard] = useState("");
  const [errs, setErrs] = useState<EntryErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async () => {
    const v = validateEntry(word, fix ? heard : "");
    if (v.word || v.heardAs) return setErrs(v);
    setBusy(true);
    try {
      await ipc.dictionaryAdd(word.trim(), fix && heard.trim() ? heard.trim() : undefined);
      setWord("");
      setHeard("");
      setErrs({});
      setServerError(null);
      await load();
    } catch (e) {
      setServerError(errText(e)); // shown under the Word field
    } finally {
      setBusy(false);
    }
  };

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

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!entries) return [];
    return q ? entries.filter((d) => d.word.toLowerCase().includes(q) || (d.heardAs ?? "").toLowerCase().includes(q)) : entries;
  }, [entries, query]);

  const live = validateEntry(word, fix ? heard : "");
  const wordError = serverError ?? (word.trim().length > WORD_MAX ? live.word : errs.word) ?? null;
  const heardError = (heard.trim().length > WORD_MAX ? live.heardAs : errs.heardAs) ?? null;
  const clearErrors = () => {
    setErrs({});
    setServerError(null);
  };

  return (
    <div>
      <PageHeader
        title="Dictionary"
        description="Names, brands and jargon Utter should always spell your way. Add a misspelling and it gets fixed every time."
        actions={
          <>
            <ImportButton onText={importCsv}>
              <Upload size={14} /> Import CSV
            </ImportButton>
            <Button size="sm" icon={<Download size={14} />} onClick={exportCsv} disabled={!entries?.length}>
              Export CSV
            </Button>
          </>
        }
      />

      <form
        className="rounded-card border border-line bg-surface p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <div className="flex items-start gap-3">
          <Input
            className="flex-1"
            label="Word or phrase"
            placeholder="Kubernetes"
            value={word}
            onChange={(e) => {
              setWord(e.target.value);
              clearErrors();
            }}
            helper={countLabel(word) ?? `Up to ${WORD_MAX} characters.`}
            error={wordError}
          />
          <Button type="submit" variant="primary" className="mt-[26px]" loading={busy} disabled={!word.trim()}>
            Add word
          </Button>
        </div>
        <div className="mt-3 flex items-center gap-2.5">
          <Switch checked={fix} onChange={setFix} label="Correct a misspelling" />
          <span className="text-[13px] text-ink">Correct a misspelling</span>
          <span className="text-xs text-muted">Utter swaps what it heard for the word above.</span>
        </div>
        {fix && (
          <Input
            className="mt-3"
            label="Heard as"
            placeholder="cooper netties"
            value={heard}
            onChange={(e) => {
              setHeard(e.target.value);
              clearErrors();
            }}
            error={heardError}
            helper={countLabel(heard) ?? "How the speech engine usually gets it wrong."}
          />
        )}
      </form>

      <div className="mt-8 flex items-center justify-between gap-4">
        <h2 className="text-[15px] font-semibold text-ink">
          Your words {entries && <span className="num ml-1 font-normal text-faint">{entries.length}</span>}
        </h2>
        {!!entries?.length && (
          <div className="relative w-[240px]">
            <Search size={14} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input
              aria-label="Search dictionary"
              placeholder="Search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-8 w-full rounded-control border border-line bg-surface pl-8 pr-3 text-[13px] placeholder:text-faint hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-0"
            />
          </div>
        )}
      </div>

      <div className="mt-3">
        {loadError ? (
          <EmptyState title="Couldn't load your dictionary" description={loadError} action={<Button onClick={() => void load()}>Try again</Button>} />
        ) : !entries ? (
          <SkeletonRows rows={4} />
        ) : entries.length === 0 ? (
          <EmptyState icon={<BookA size={18} />} title="No words yet" description="Add a name or term above. Utter also learns words when you fix them in History." />
        ) : shown.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">No words match "{query}".</p>
        ) : (
          <ul className="divide-y divide-line rounded-card border border-line bg-surface">
            {shown.map((d) => (
              <li key={d.id} className="group flex items-center gap-3 px-4 py-2.5">
                <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                  {d.heardAs && (
                    <>
                      <span className="truncate text-muted line-through decoration-faint">{d.heardAs}</span>
                      <span aria-label="becomes" className="text-faint">
                        →
                      </span>
                    </>
                  )}
                  <span className="truncate font-medium text-ink">{d.word}</span>
                </div>
                {d.auto && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-highlight-soft px-2 py-0.5 text-[11px] font-medium text-ink" title="Utter learned this from your edits">
                    <Sparkles size={11} aria-hidden /> Learned
                  </span>
                )}
                <IconButton label={`Delete ${d.word}`} className="opacity-0 focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100" onClick={() => void remove(d.id)}>
                  <Trash2 size={15} />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
