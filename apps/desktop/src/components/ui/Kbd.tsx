import type { ReactNode } from "react";
import { formatChord } from "../../lib/format";
import { cn } from "../../lib/cn";

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-[6px] border border-b-2 border-line-strong",
        "bg-surface px-1.5 font-mono text-[11px] font-medium text-ink",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/** A chord rendered as keycaps. Accepts "Ctrl+Win" or ["Ctrl","Win"]. */
export function Chord({ chord, className }: { chord: string | string[] | undefined; className?: string }) {
  const keys = formatChord(chord);
  if (keys.length === 0) return <span className="text-xs text-faint">Not set</span>;
  return (
    <span className={cn("inline-flex items-center gap-1", className)} aria-label={keys.join(" plus ")}>
      {keys.map((k, i) => (
        <Kbd key={`${k}-${i}`}>{k}</Kbd>
      ))}
    </span>
  );
}
