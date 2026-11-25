import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";

/** Bordered surface. Use sparingly: only when grouping needs an edge. */
export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-card border border-line bg-surface", className)} {...rest} />;
}

export function CardSection({ title, description, children, className }: { title?: string; description?: string; children: ReactNode; className?: string }) {
  return (
    <Card className={cn("px-5 py-4", className)}>
      {title && <h2 className="text-[15px] font-semibold text-ink">{title}</h2>}
      {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
      <div className={title ? "mt-3" : ""}>{children}</div>
    </Card>
  );
}
