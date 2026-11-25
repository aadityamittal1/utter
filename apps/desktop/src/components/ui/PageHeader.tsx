import type { ReactNode } from "react";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="flex items-end justify-between gap-6 pb-6">
      <div className="min-w-0">
        <h1 className="font-display text-[34px] leading-[1.1] tracking-[-0.01em] text-ink">{title}</h1>
        {description && <p className="mt-1.5 max-w-[60ch] text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
