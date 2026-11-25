import { formatNumber } from "../../../lib/format";

export interface BarItem {
  label: string;
  value: number;
}

/** Horizontal bars on one shared scale, single hue, no background track. */
export function BarList({ items, empty }: { items: BarItem[]; empty: string }) {
  if (items.length === 0) return <p className="text-[13px] text-muted">{empty}</p>;
  const max = Math.max(...items.map((i) => i.value), 1);
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  return (
    <ul className="flex flex-col gap-3">
      {items.map((i) => (
        <li key={i.label} title={`${i.label}: ${formatNumber(i.value)} words (${Math.round((i.value / total) * 100)}%)`}>
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="truncate text-ink">{i.label}</span>
            <span className="shrink-0 tabular-nums text-muted">{formatNumber(i.value)}</span>
          </div>
          <div className="mt-1 h-1.5">
            <div className="h-full rounded-r-[4px] bg-ember" style={{ width: `${Math.max(2, (i.value / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
