import { useState, type CSSProperties } from "react";
import { formatNumber } from "../../../lib/format";
import { heatLevel } from "./scale";

// Monday-first, matching the backend's heatmap rows.
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const FULL_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const HOUR_TICKS = [0, 6, 12, 18];
const LEVEL_MIX = [0, 22, 45, 70, 100];

function hourLabel(h: number): string {
  if (h === 0) return "12am";
  if (h < 12) return `${h}am`;
  if (h === 12) return "12pm";
  return `${h - 12}pm`;
}

function cellStyle(level: number): CSSProperties {
  if (level === 0) return { background: "var(--surface-muted)" };
  return { background: `color-mix(in oklab, var(--accent-fill) ${LEVEL_MIX[level]}%, var(--surface-muted))` };
}

export function Heatmap({ data }: { data: number[][] }) {
  const [active, setActive] = useState<{ d: number; h: number } | null>(null);
  const max = Math.max(0, ...data.flat());
  const activeValue = active ? (data[active.d]?.[active.h] ?? 0) : null;

  return (
    <div>
      <div className="grid gap-[3px]" style={{ gridTemplateColumns: "32px repeat(24, minmax(0, 1fr))" }}>
        {data.slice(0, 7).map((row, d) => (
          <div key={d} className="contents">
            <div className="flex items-center text-[11px] text-faint">{DAYS[d]}</div>
            {row.map((v, h) => (
              <button
                key={h}
                type="button"
                onMouseEnter={() => setActive({ d, h })}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive({ d, h })}
                onBlur={() => setActive(null)}
                aria-label={`${FULL_DAYS[d]} ${hourLabel(h)}: ${formatNumber(v)} words`}
                className="aspect-square min-h-3 rounded-[3px] transition-transform hover:scale-110"
                style={cellStyle(heatLevel(v, max))}
              />
            ))}
          </div>
        ))}
        <div />
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} className="relative h-4 text-[10px] text-faint">
            {HOUR_TICKS.includes(h) && <span className="absolute left-0 whitespace-nowrap">{hourLabel(h)}</span>}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-muted">
        <span aria-live="polite" className="min-h-4">
          {active && activeValue !== null ? `${FULL_DAYS[active.d]} ${hourLabel(active.h)}: ${formatNumber(activeValue)} words` : ""}
        </span>
        <span className="flex items-center gap-1.5" aria-hidden>
          Less
          {[0, 1, 2, 3, 4].map((l) => (
            <span key={l} className="size-3 rounded-[3px]" style={cellStyle(l)} />
          ))}
          More
        </span>
      </div>
    </div>
  );
}
