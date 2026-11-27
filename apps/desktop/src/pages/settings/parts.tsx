import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { useSettings } from "../../lib/store";
import type { Settings } from "../../lib/types";
import { SkeletonRows } from "../../components/ui";

/** Titled group of rows separated by hairlines. */
export function Section({ title, description, children, className }: { title: string; description?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("py-2", className)}>
      <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
      {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
      <div className="mt-2 divide-y divide-line border-t border-line">{children}</div>
    </section>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "ember" | "success" | "lilac" }) {
  const tones = {
    neutral: "bg-muted-surface text-muted",
    ember: "bg-ember-soft text-ember-text",
    success: "bg-success-soft text-success",
    lilac: "bg-highlight-soft text-highlight",
  };
  return <span className={cn("inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium", tones[tone])}>{children}</span>;
}

/** Renders `children` once settings have loaded; otherwise a skeleton or error. */
export function WithSettings({ children }: { children: (s: Settings, update: (p: Partial<Settings>) => Promise<void>) => ReactNode }) {
  const settings = useSettings((s) => s.settings);
  const error = useSettings((s) => s.error);
  const update = useSettings((s) => s.update);
  if (!settings) {
    return error ? (
      <p role="alert" className="text-sm text-danger">
        Couldn't load settings: {error}
      </p>
    ) : (
      <SkeletonRows rows={4} />
    );
  }
  return <>{children(settings, update)}</>;
}
