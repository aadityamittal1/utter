import type { HTMLAttributes, ReactNode } from "react";
import { Card as HeroCard } from "@heroui/react";
import { cn } from "../../lib/cn";

/** Bordered surface (radius 16, hairline). Padding is the caller's: HeroUI's own is reset. */
export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <HeroCard variant="default" className={cn("gap-0 rounded-card border border-line bg-surface p-0 shadow-none", className)} {...rest}>
      {children}
    </HeroCard>
  );
}

export function CardSection({ title, description, children, className }: { title?: string; description?: string; children: ReactNode; className?: string }) {
  return (
    <Card className={cn("px-5 py-4", className)}>
      {title && <h2 className="text-body-strong text-ink">{title}</h2>}
      {description && <p className="mt-0.5 text-caption text-muted">{description}</p>}
      <div className={title ? "mt-3" : ""}>{children}</div>
    </Card>
  );
}
