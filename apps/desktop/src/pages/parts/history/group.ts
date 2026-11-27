import { formatTime } from "../../../lib/format";
import type { HistoryItem } from "../../../lib/types";

export interface DayGroup {
  /** Local midnight of the day, in ms. Stable key. */
  key: number;
  /** "Today", "Yesterday" or "Tuesday, November 24" (with the year when it is not this year). */
  label: string;
  items: HistoryItem[];
}

const DAY = 86_400_000;

const startOfDay = (ms: number): number => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Day heading for a dictation: relative for the last two days, otherwise a full date. */
export function dayLabel(ms: number, now: number = Date.now()): string {
  const diff = Math.round((startOfDay(now) - startOfDay(ms)) / DAY);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  const sameYear = new Date(ms).getFullYear() === new Date(now).getFullYear();
  return new Date(ms).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

/** Group newest-first items by local calendar day, keeping their order. */
export function groupByDay(items: HistoryItem[], now: number = Date.now()): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const it of items) {
    const key = startOfDay(it.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(it);
    else groups.push({ key, label: dayLabel(it.createdAt, now), items: [it] });
  }
  return groups;
}

/** Compact clock for the time column: "2:35pm" (no space, lowercase). */
export function clockLabel(ms: number): string {
  return formatTime(ms).replace(/s/g, "").toLowerCase();
}
