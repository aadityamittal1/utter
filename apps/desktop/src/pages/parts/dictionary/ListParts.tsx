import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ArrowDownAZ, ArrowUpDown, Check, Search, X } from "lucide-react";
import { Label } from "@heroui/react";
import { Dropdown, IconButton, Tabs } from "../../../components/ui";
import { cn } from "../../../lib/cn";

export interface TabDef {
  id: string;
  label: string;
}

/** Underline tabs (HeroUI Tabs, secondary variant). Selection only: the page renders the content. */
export function PageTabs({ tabs, value, onChange, label }: { tabs: TabDef[]; value: string; onChange: (id: string) => void; label: string }) {
  return (
    <Tabs variant="secondary" selectedKey={value} onSelectionChange={(k) => onChange(String(k))} className="w-full min-w-0">
      <Tabs.ListContainer>
        <Tabs.List aria-label={label}>
          {tabs.map((t) => (
            <Tabs.Tab key={t.id} id={t.id} className="h-10 w-auto flex-none px-0 text-body-strong [&:not(:last-child)]:mr-8">
              {t.label}
              <Tabs.Indicator />
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs.ListContainer>
    </Tabs>
  );
}

export type SortKey = "recent" | "az";
const SORTS: { id: SortKey; label: string }[] = [
  { id: "recent", label: "Recently added" },
  { id: "az", label: "A to Z" },
];

/**
 * Row above a list: optional tabs on the left, search and sort icon buttons on the right.
 * Search opens an inline field (Esc closes and clears it); extra icon buttons come in `extra`.
 */
export function ListToolbar({
  tabs,
  extra,
  query,
  onQuery,
  sort,
  onSort,
  searchLabel,
  disabled,
}: {
  tabs?: ReactNode;
  extra?: ReactNode;
  query: string;
  onQuery: (q: string) => void;
  sort: SortKey;
  onSort: (s: SortKey) => void;
  searchLabel: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  const searching = open || query !== "";

  return (
    <div className="flex min-h-12 items-center justify-between gap-4 border-b border-line">
      <div className="min-w-0 self-end">{tabs}</div>
      <div className="flex items-center gap-1 pb-1">
        {searching && (
          <div className="relative mr-1 w-56">
            <Search size={16} strokeWidth={1.5} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
            <input
              ref={input}
              aria-label={searchLabel}
              placeholder="Search"
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  onQuery("");
                  setOpen(false);
                }
              }}
              onBlur={() => query === "" && setOpen(false)}
              className="h-8 w-full rounded-control border border-line-strong bg-surface pl-8 pr-8 text-body text-ink placeholder:text-faint"
            />
            {query !== "" && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  onQuery("");
                  input.current?.focus();
                }}
                className="absolute right-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-faint hover:text-ink"
              >
                <X size={16} strokeWidth={1.5} />
              </button>
            )}
          </div>
        )}
        {!searching && (
          <IconButton label={searchLabel} disabled={disabled} onClick={() => setOpen(true)}>
            <Search size={16} strokeWidth={1.5} />
          </IconButton>
        )}
        <Dropdown>
          <Dropdown.Trigger
            aria-label="Sort"
            isDisabled={disabled}
            className={cn(
              "inline-flex size-8 items-center justify-center rounded-control text-muted outline-none transition-colors duration-[var(--dur-fast)] ease-fluent hover:bg-hover data-[pressed]:bg-active",
              "data-[disabled]:opacity-50",
            )}
          >
            {sort === "az" ? <ArrowDownAZ size={16} strokeWidth={1.5} /> : <ArrowUpDown size={16} strokeWidth={1.5} />}
          </Dropdown.Trigger>
          <Dropdown.Popover placement="bottom end">
            <Dropdown.Menu aria-label="Sort by" selectionMode="single" selectedKeys={[sort]} onAction={(k) => onSort(String(k) as SortKey)}>
              {SORTS.map((s) => (
                <Dropdown.Item key={s.id} id={s.id} textValue={s.label}>
                  <Label>{s.label}</Label>
                  <Check size={16} strokeWidth={1.5} aria-hidden className={sort === s.id ? "ml-auto" : "ml-auto invisible"} />
                </Dropdown.Item>
              ))}
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
        {extra}
      </div>
    </div>
  );
}

/** One card, hairline, radius 16; rows are `ListRow`s. */
export function ListCard({ children }: { children: ReactNode }) {
  return <ul className="mt-6 divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">{children}</ul>;
}

/** 56px row; `actions` fade in on hover or focus. */
export function ListRow({ children, actions, onActivate }: { children: ReactNode; actions?: ReactNode; onActivate?: () => void }) {
  return (
    <li className="group flex min-h-14 items-center gap-3 px-5 py-2 transition-colors duration-[var(--dur-fast)] ease-fluent hover:bg-row-hover focus-within:bg-row-hover" onDoubleClick={onActivate}>
      <div className="min-w-0 flex-1">{children}</div>
      {actions && (
        <div className="flex shrink-0 items-center opacity-0 transition-opacity duration-[var(--dur-fast)] ease-fluent focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">{actions}</div>
      )}
    </li>
  );
}
