import type { ReactNode } from "react";
import { Kbd as HeroKbd } from "@heroui/react";
import { formatChord } from "../../lib/format";
import { cn } from "../../lib/cn";

/** A keycap. The product's signature: used for every shortcut. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <HeroKbd
      className={cn(
        "h-6 min-w-6 justify-center rounded-[6px] border border-b-2 border-line-strong bg-surface px-1.5 font-sans text-caption font-medium text-ink shadow-none",
        className,
      )}
    >
      <HeroKbd.Content>{children}</HeroKbd.Content>
    </HeroKbd>
  );
}

/** A chord rendered as keycaps. Accepts "Ctrl+Win" or ["Ctrl","Win"]. */
export function Chord({ chord, className }: { chord: string | string[] | undefined; className?: string }) {
  const keys = formatChord(chord);
  if (keys.length === 0) return <span className="text-caption text-faint">Not set</span>;
  return (
    <span className={cn("inline-flex items-center gap-1", className)} aria-label={keys.join(" plus ")}>
      {keys.map((k, i) => (
        <Kbd key={`${k}-${i}`}>{k}</Kbd>
      ))}
    </span>
  );
}
