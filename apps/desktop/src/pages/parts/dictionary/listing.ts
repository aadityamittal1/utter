import type { DictEntry, Snippet } from "../../../lib/types";

export type SortKey = "recent" | "az";
export type DictTab = "all" | "replacements" | "words";

/** Numeric part of a row id (SQLite rowid, possibly prefixed like "d_12"); 0 when there is none. */
export function idNum(id: string): number {
  const tail = id.split("_").pop() ?? "";
  if (/^\d+$/.test(tail)) return parseInt(tail, 10);
  const n = parseInt(tail, 36);
  return Number.isNaN(n) ? 0 : n;
}

const byText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });

function sorted<T extends { id: string }>(list: T[], sort: SortKey, text: (t: T) => string): T[] {
  return [...list].sort(sort === "az" ? (a, b) => byText(text(a), text(b)) : (a, b) => idNum(b.id) - idNum(a.id));
}

/** Tab + search filter, then sort. "recent" is newest first by id; "az" is by word. */
export function listDictionary(entries: DictEntry[], tab: DictTab, query: string, sort: SortKey): DictEntry[] {
  const q = query.trim().toLowerCase();
  let list = entries.filter((d) => (tab === "replacements" ? !!d.heardAs : tab === "words" ? !d.heardAs : true));
  if (q) list = list.filter((d) => d.word.toLowerCase().includes(q) || (d.heardAs ?? "").toLowerCase().includes(q));
  return sorted(list, sort, (d) => d.word);
}

export function listSnippets(items: Snippet[], query: string, sort: SortKey): Snippet[] {
  const q = query.trim().toLowerCase();
  const list = q ? items.filter((s) => s.trigger.toLowerCase().includes(q) || s.expansion.toLowerCase().includes(q)) : items;
  return sorted(list, sort, (s) => s.trigger);
}
