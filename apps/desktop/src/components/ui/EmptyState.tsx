import type { ReactNode } from "react";

/** The one empty-state pattern: dashed card, icon, title, one line, optional action. */
export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-card border border-dashed border-line-strong px-8 py-14 text-center">
      {icon && <div className="mb-4 flex size-10 items-center justify-center rounded-full bg-muted-surface text-muted">{icon}</div>}
      <h3 className="text-body-strong text-ink">{title}</h3>
      {description && <p className="mt-1 max-w-[42ch] text-caption text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Loading placeholder shaped like list rows. */
export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton h-12" style={{ opacity: 1 - i * 0.14 }} />
      ))}
    </div>
  );
}
