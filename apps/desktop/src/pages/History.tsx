import { useCallback, useEffect, useRef, useState } from "react";
import { History as HistoryIcon, Search, Trash2 } from "lucide-react";
import { ipc } from "../lib/ipc";
import { relativeDay } from "../lib/format";
import { toast } from "../lib/store";
import { useBackendEvent } from "../lib/useBackendEvent";
import type { HistoryItem } from "../lib/types";
import { Button, EmptyState, Input, PageHeader, SkeletonRows } from "../components/ui";
import { HistoryRow } from "./parts/history/HistoryRow";
import { createLatestGuard } from "./parts/history/latest";

const PAGE = 50;

function groupByDay(items: HistoryItem[]): { day: string; items: HistoryItem[] }[] {
  const groups: { day: string; items: HistoryItem[] }[] = [];
  for (const it of items) {
    const day = relativeDay(it.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(it);
    else groups.push({ day, items: [it] });
  }
  return groups;
}

export default function History() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const count = useRef(PAGE);
  const loaded = useRef(false);
  const guard = useRef(createLatestGuard());

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(t);
  }, [query]);

  /** Fetch `limit` rows. Out-of-order responses are dropped; returns true if applied. */
  const fetchRows = useCallback(
    async (limit: number): Promise<boolean> => {
      const isLatest = guard.current.next();
      try {
        const rows = await ipc.historyList(debounced || undefined, limit, 0);
        if (!isLatest()) return false;
        count.current = limit;
        loaded.current = true;
        setItems(rows);
        setMore(rows.length >= limit);
        setError(null);
        return true;
      } catch (e) {
        if (!isLatest()) return false;
        if (loaded.current) toast.error(`Couldn't refresh history: ${String(e)}`);
        else setError(String(e));
        return false;
      }
    },
    [debounced],
  );
  const load = useCallback((reset = false) => void fetchRows(reset ? PAGE : count.current), [fetchRows]);
  useEffect(() => load(true), [load]);
  useBackendEvent("history://changed", () => load());

  async function loadMore() {
    setLoadingMore(true);
    // count only advances when the larger page actually loads
    await fetchRows(count.current + PAGE);
    setLoadingMore(false);
  }

  async function clearAll() {
    try {
      await ipc.historyClear();
      setConfirmClear(false);
      load(true);
    } catch (e) {
      toast.error(String(e));
    }
  }

  const hasAny = (items?.length ?? 0) > 0;
  const actions = confirmClear ? (
    <>
      <span className="text-[13px] text-muted">Delete all history?</span>
      <Button variant="danger" onClick={clearAll}>
        Delete all
      </Button>
      <Button variant="ghost" onClick={() => setConfirmClear(false)}>
        Cancel
      </Button>
    </>
  ) : (
    <Button variant="ghost" icon={<Trash2 size={14} />} disabled={!hasAny} onClick={() => setConfirmClear(true)}>
      Clear all
    </Button>
  );

  return (
    <>
      <PageHeader title="History" description="Everything you have dictated, searchable." actions={actions} />
      <div className="relative mb-4">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
        <Input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search text or app"
          aria-label="Search history"
          className="pl-9"
        />
      </div>

      {error && !items ? (
        <EmptyState icon={<HistoryIcon size={18} />} title="Couldn't load history" description={error} action={<Button onClick={() => load(true)}>Try again</Button>} />
      ) : items === null ? (
        <SkeletonRows rows={6} />
      ) : items.length === 0 ? (
        debounced ? (
          <EmptyState icon={<Search size={18} />} title="No matches" description={`Nothing in your history matches "${debounced}".`} />
        ) : (
          <EmptyState icon={<HistoryIcon size={18} />} title="No dictations yet" description="Hold your dictate shortcut in any app. What you say will show up here, so you can copy or re-insert it later." />
        )
      ) : (
        <div className="flex flex-col gap-5 pb-10">
          {groupByDay(items).map((g) => (
            <section key={g.day} aria-label={g.day}>
              <h2 className="px-3 pb-1 text-[12px] font-medium text-faint">{g.day}</h2>
              <ul className="flex flex-col">
                {g.items.map((it) => (
                  <HistoryRow key={it.id} item={it} onChanged={() => load()} />
                ))}
              </ul>
            </section>
          ))}
          {more && (
            <div className="flex justify-center">
              <Button loading={loadingMore} onClick={loadMore}>
                Load more
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
