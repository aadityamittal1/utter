import type { ReactNode } from "react";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="flex items-end justify-between gap-6 pb-6">
      <div className="min-w-0">
        <h1 className="text-title text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-[60ch] text-body text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
