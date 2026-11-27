import type { ReactNode } from "react";
import type { HistoryItem } from "../../../lib/types";
import { groupByDay } from "./group";
import { HistoryRow } from "./HistoryRow";

/**
 * Dictations grouped by day: an uppercase date label, then one hairline card per day
 * with divided rows. Shared by Home and History.
 */
export function DayList({ items, onChanged, firstGroupAction }: { items: HistoryItem[]; onChanged: () => void; firstGroupAction?: ReactNode }) {
  return (
    <div className="flex flex-col gap-6">
      {groupByDay(items).map((g, i) => (
        <section key={g.key} aria-label={g.label}>
          <div className="mb-2 flex items-center justify-between gap-4 px-1">
            <h2 className="text-group-label text-faint">{g.label}</h2>
            {i === 0 && firstGroupAction}
          </div>
          <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
            {g.items.map((it) => (
              <HistoryRow key={it.id} item={it} onChanged={onChanged} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
