import type { ReactNode } from "react";
import { X } from "lucide-react";
import { IconButton } from "../../../components/ui";
import { cn } from "../../../lib/cn";

/** Light-on-dark button classes for use inside a Banner. */
export const BANNER_BUTTON = "bg-on-banner text-banner hover:bg-on-banner/90 data-[pressed]:bg-on-banner/80";

/** Ember sound wave: a smooth swell of rounded bars. Decorative and static. */
const WAVE_BARS = Array.from({ length: 21 }, (_, i) => {
  const t = i / 20;
  const envelope = Math.sin(Math.PI * t) ** 1.2;
  const ripple = 0.55 + 0.45 * Math.abs(Math.sin(i * 1.7));
  return Math.max(6, Math.round(88 * envelope * ripple));
});

export function EmberWaveform({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 252 100" className={cn("h-24 w-auto", className)} aria-hidden>
      {WAVE_BARS.map((h, i) => (
        <rect key={i} x={i * 12 + 1} y={50 - h / 2} width={6} height={h} rx={3} className={i % 5 === 2 ? "fill-ember" : "fill-ember/70"} />
      ))}
    </svg>
  );
}

/** Lines of text being rewritten: the grey draft becomes the ember result. Decorative. */
export function RewriteLines({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 240 112" className={cn("h-24 w-auto", className)} aria-hidden>
      <rect x={0} y={8} width={150} height={8} rx={4} className="fill-on-banner/25" />
      <rect x={0} y={28} width={196} height={8} rx={4} className="fill-on-banner/25" />
      <rect x={0} y={48} width={118} height={8} rx={4} className="fill-on-banner/25" />
      <rect x={0} y={76} width={170} height={8} rx={4} className="fill-ember" />
      <rect x={0} y={96} width={104} height={8} rx={4} className="fill-ember/70" />
      <rect x={112} y={92} width={3} height={16} rx={1.5} className="fill-on-banner" />
    </svg>
  );
}

/**
 * Dark card (radius 16) with a serif headline, one line of copy, optional actions,
 * decorative art on the right and an optional dismiss button. Dark in both themes.
 */
export function Banner({
  title,
  children,
  actions,
  art,
  onDismiss,
  className,
}: {
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  art?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}) {
  return (
    <section className={cn("relative flex items-center justify-between gap-8 overflow-hidden rounded-card border border-line bg-banner px-8 py-7 text-on-banner", className)}>
      <div className="min-w-0 max-w-[44ch]">
        <h2 className="text-serif-heading text-on-banner">{title}</h2>
        {children && <p className="mt-2 text-body text-on-banner-muted">{children}</p>}
        {actions && <div className="mt-5 flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {art && <div className="hidden shrink-0 pr-2 sm:block">{art}</div>}
      {onDismiss && (
        <IconButton label="Dismiss" onClick={onDismiss} className="absolute right-3 top-3 text-on-banner-muted hover:text-on-banner">
          <X size={16} strokeWidth={1.5} />
        </IconButton>
      )}
    </section>
  );
}
