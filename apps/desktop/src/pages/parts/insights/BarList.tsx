import type { ReactNode } from "react";
import { formatNumber } from "../../../lib/format";

export interface BarItem {
  label: string;
  value: number;
  icon?: ReactNode;
}

/**
 * Horizontal bars: ember fill sized by share of the total, percentage inside,
 * label and word count to the right.
 */
export function BarList({ items, empty }: { items: BarItem[]; empty: string }) {
  if (items.length === 0) return <p className="text-body text-muted">{empty}</p>;
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  return (
    <ul className="flex flex-col gap-3">
      {items.map((i) => {
        const pct = Math.round((i.value / total) * 100);
        return (
          <li key={i.label} className="flex items-center gap-3" title={`${i.label}: ${formatNumber(i.value)} words (${pct}%)`}>
            {i.icon && <span className="flex size-5 shrink-0 items-center justify-center text-muted">{i.icon}</span>}
            <div className="min-w-0 flex-1">
              <div
                className="flex h-8 min-w-12 items-center rounded-control bg-ember px-3 text-body-strong text-on-ember tabular-nums"
                style={{ width: `${Math.max(8, (i.value / total) * 100)}%` }}
              >
                {pct}%
              </div>
            </div>
            <div className="w-[116px] shrink-0 truncate text-body text-ink">
              {i.label} <span className="text-muted tabular-nums">{formatNumber(i.value)}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
