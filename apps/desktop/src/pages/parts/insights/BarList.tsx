import type { ReactNode } from "react";
import { formatNumber } from "../../../lib/format";

export interface BarItem {
  label: string;
  value: number;
  icon?: ReactNode;
}

/** Below this share the percentage no longer fits inside the bar and sits after it. */
const INSIDE_MIN = 12;

/**
 * Horizontal bars sized by share of `total` (true magnitude, no minimum width): ember fill,
 * percentage inside when it fits, label and word count above.
 */
export function BarList({ items, total, empty }: { items: BarItem[]; total: number; empty: string }) {
  if (items.length === 0) return <p className="text-body text-muted">{empty}</p>;
  const whole = total > 0 ? total : items.reduce((s, i) => s + i.value, 0) || 1;
  return (
    <ul className="flex flex-col gap-4">
      {items.map((i) => {
        const share = (i.value / whole) * 100;
        const pct = Math.round(share);
        const inside = share >= INSIDE_MIN;
        return (
          <li key={i.label} className="flex items-start gap-3" title={`${i.label}: ${formatNumber(i.value)} words (${pct}%)`}>
            {i.icon && <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center text-muted">{i.icon}</span>}
            <div className="min-w-0 flex-1">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 text-body">
                <span className="truncate text-ink">{i.label}</span>
                <span className="text-muted tabular-nums">{formatNumber(i.value)}</span>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <div
                  className="flex h-6 items-center rounded-sm bg-ember px-2 text-caption font-medium text-on-ember tabular-nums"
                  style={{ width: `${Math.max(0.5, share)}%`, paddingInline: inside ? undefined : 0 }}
                >
                  {inside && `${pct}%`}
                </div>
                {!inside && <span className="text-caption text-muted tabular-nums">{pct}%</span>}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
