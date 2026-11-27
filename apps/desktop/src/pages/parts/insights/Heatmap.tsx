import { useState, type CSSProperties } from "react";
import { formatNumber } from "../../../lib/format";
import { heatLevel, topSlots } from "./scale";

// Monday-first, matching the backend's heatmap rows.
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const FULL_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const HOUR_TICKS = [0, 6, 12, 18];
// Ember ramp: empty plus four steps.
const LEVEL_MIX = [0, 30, 55, 78, 100];

function hourLabel(h: number): string {
  if (h === 0) return "12am";
  if (h < 12) return `${h}am`;
  if (h === 12) return "12pm";
  return `${h - 12}pm`;
}

function cellStyle(level: number): CSSProperties {
  if (level === 0) return { background: "var(--surface-tertiary)" };
  return { background: `color-mix(in oklab, var(--ember) ${LEVEL_MIX[level]}%, var(--surface-tertiary))` };
}

/** Weekday by hour of day. The backend gives words per (weekday, hour), not per calendar date. */
export function Heatmap({ data }: { data: number[][] }) {
  const [active, setActive] = useState<{ d: number; h: number } | null>(null);
  const max = Math.max(0, ...data.flat());
  const top = topSlots(data, 3);
  const summary =
    top.length === 0
      ? "Words by weekday and hour. No data yet."
      : `Words by weekday and hour. Busiest times: ${top.map((s) => `${FULL_DAYS[s.d]} ${hourLabel(s.h)}, ${formatNumber(s.v)} words`).join("; ")}.`;
  const activeValue = active ? (data[active.d]?.[active.h] ?? 0) : null;

  return (
    <div>
      <div role="img" aria-label={summary} className="grid gap-[3px]" style={{ gridTemplateColumns: "32px repeat(24, minmax(0, 1fr))" }}>
        <div />
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} className="relative h-4 text-caption text-faint">
            {HOUR_TICKS.includes(h) && <span className="absolute left-0 whitespace-nowrap">{hourLabel(h)}</span>}
          </div>
        ))}
        {data.slice(0, 7).map((row, d) => (
          <div key={d} className="contents">
            <div className="flex items-center text-caption text-faint">{DAYS[d]}</div>
            {row.map((v, h) => (
              <div key={h} onMouseEnter={() => setActive({ d, h })} onMouseLeave={() => setActive(null)} className="aspect-square rounded-sm" style={cellStyle(heatLevel(v, max))} />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 text-caption text-muted">
        <span aria-hidden className="min-h-4 tabular-nums">
          {active && activeValue !== null ? `${FULL_DAYS[active.d]} ${hourLabel(active.h)}: ${formatNumber(activeValue)} words` : ""}
        </span>
        <span className="flex shrink-0 items-center gap-1.5" aria-hidden>
          More
          {[4, 3, 2, 1, 0].map((l) => (
            <span key={l} className="size-3 rounded-sm" style={cellStyle(l)} />
          ))}
          Less
        </span>
      </div>
    </div>
  );
}
