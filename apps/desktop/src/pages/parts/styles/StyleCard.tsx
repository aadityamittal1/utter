import { Check } from "lucide-react";
import { cn } from "../../../lib/cn";
import type { Category, StyleKind } from "../../../lib/types";
import { renderExample, STYLE_LABELS, STYLE_TRAITS } from "./examples";

/**
 * One style as a radio card: name, what it does, and the same request as a chat bubble with
 * your initial. The selected card carries a 2px ember border and a check (not colour alone).
 */
export function StyleCard({
  kind,
  category,
  selected,
  tabbable,
  initial,
  onSelect,
}: {
  kind: StyleKind;
  category: Category;
  selected: boolean;
  tabbable: boolean;
  initial: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      data-kind={kind}
      tabIndex={tabbable ? 0 : -1}
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex min-h-60 flex-col rounded-card bg-surface text-left transition-colors duration-[var(--dur-fast)] ease-fluent",
        selected ? "border-2 border-ember p-[19px]" : "border border-line p-5 hover:border-line-strong hover:bg-row-hover",
      )}
    >
      <span className="flex items-start justify-between gap-2">
        <span>
          <span className="block text-body-strong text-ink">{STYLE_LABELS[kind]}</span>
          <span className="mt-0.5 block text-caption text-muted">{STYLE_TRAITS[kind]}</span>
        </span>
        {selected && <Check size={16} strokeWidth={1.5} aria-hidden className="mt-0.5 shrink-0 text-ember-text" />}
      </span>
      <span className="mt-auto block rounded-[14px] bg-muted-surface px-4 py-3 text-body text-ink">{renderExample(kind, category)}</span>
      <span
        aria-hidden
        className={cn(
          "mt-3 flex size-10 items-center justify-center self-end rounded-full text-body-strong",
          selected ? "bg-ember text-on-ember" : "bg-ember-soft text-ember-text",
        )}
      >
        {initial}
      </span>
    </button>
  );
}
