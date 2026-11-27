import type { ReactNode } from "react";
import { Button, SkeletonRows } from "../../components/ui";
import type { ButtonProps } from "../../components/ui/Button";
import { cn } from "../../lib/cn";
import { useSettings } from "../../lib/store";
import type { Settings } from "../../lib/types";

/** A settings page: serif title, then groups. */
export function SettingsPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-8 pb-4">
      <h1 className="text-serif-heading text-ink">{title}</h1>
      {children}
    </div>
  );
}

/** Heading + a raised card whose rows are separated by hairlines. */
export function Group({ title, description, children, className }: { title?: string; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      {(title || description) && (
        <div>
          {title && <h2 className="text-body-lg font-medium text-ink">{title}</h2>}
          {description && <p className="mt-0.5 text-body text-muted">{description}</p>}
        </div>
      )}
      <div className="divide-y divide-line rounded-card bg-muted-surface px-5">{children}</div>
    </section>
  );
}

/** Label and description on the left, the control on the right. */
export function Row({ title, description, children, top, className }: { title: ReactNode; description?: ReactNode; children?: ReactNode; top?: boolean; className?: string }) {
  return (
    <div className={cn("flex justify-between gap-6 py-4", top ? "items-start" : "items-center", className)}>
      <div className="min-w-0">
        <div className="text-body-strong text-ink">{title}</div>
        {description && <div className="mt-0.5 max-w-[52ch] text-body text-muted">{description}</div>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}

/** A row that needs the full card width (forms, tables). */
export function Block({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("py-4", className)}>{children}</div>;
}

/** The raised "Change"-style button: a step darker than the card it sits on. */
export function RaisedButton({ className, ...props }: ButtonProps) {
  return <Button variant="secondary" size="sm" className={cn("bg-(--surface-tertiary)", className)} {...props} />;
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "ember" | "success" }) {
  const tones = {
    neutral: "bg-(--surface-tertiary) text-muted",
    ember: "bg-ember-soft text-ember-text",
    success: "bg-success-soft text-success",
  };
  return <span className={cn("inline-flex h-5 items-center rounded-full px-2 text-caption font-medium", tones[tone])}>{children}</span>;
}

/** Renders `children` once settings have loaded; otherwise a skeleton or error. */
export function WithSettings({ children }: { children: (s: Settings, update: (p: Partial<Settings>) => Promise<void>) => ReactNode }) {
  const settings = useSettings((s) => s.settings);
  const error = useSettings((s) => s.error);
  const update = useSettings((s) => s.update);
  if (!settings) {
    return error ? (
      <p role="alert" className="text-body text-danger">
        Couldn't load settings: {error}
      </p>
    ) : (
      <SkeletonRows rows={4} />
    );
  }
  return <>{children(settings, update)}</>;
}
