import type { LucideIcon } from "lucide-react";
import { BookA, ChartColumn, History, House, Palette, Settings, StickyNote, TextCursorInput, WandSparkles } from "lucide-react";
import { useNav } from "../lib/store";
import type { Page } from "../lib/types";
import { cn } from "../lib/cn";
import { Logo } from "./Logo";

export interface NavItem {
  page: Page;
  label: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { page: "home", label: "Home", icon: House },
  { page: "history", label: "History", icon: History },
  { page: "dictionary", label: "Dictionary", icon: BookA },
  { page: "snippets", label: "Snippets", icon: TextCursorInput },
  { page: "styles", label: "Styles", icon: Palette },
  { page: "transforms", label: "Transforms", icon: WandSparkles },
  { page: "notes", label: "Notes", icon: StickyNote },
  { page: "insights", label: "Insights", icon: ChartColumn },
];

const SETTINGS_ITEM: NavItem = { page: "settings", label: "Settings", icon: Settings };

function NavButton({ item, active, onSelect }: { item: NavItem; active: boolean; onSelect: (p: Page) => void }) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={() => onSelect(item.page)}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex h-9 w-full items-center gap-2.5 rounded-control px-2.5 text-sm transition-colors duration-150",
        active ? "bg-muted-surface font-medium text-ink" : "text-muted hover:bg-hover hover:text-ink",
      )}
    >
      <Icon size={17} strokeWidth={1.75} aria-hidden className={cn("shrink-0 transition-colors", active ? "text-accent" : "text-faint group-hover:text-muted")} />
      {item.label}
    </button>
  );
}

export function Sidebar() {
  const page = useNav((s) => s.page);
  const navigate = useNav((s) => s.navigate);

  return (
    <aside className="flex h-full w-[232px] shrink-0 flex-col border-r border-line bg-bg px-3 pb-4 pt-5">
      <div data-tauri-drag-region className="px-2.5 pb-6 pt-1">
        <Logo height={17} />
      </div>
      <nav aria-label="Main" className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
        {NAV_ITEMS.map((item) => (
          <NavButton key={item.page} item={item} active={page === item.page} onSelect={navigate} />
        ))}
      </nav>
      <div className="mt-3 flex flex-col gap-3 border-t border-line pt-3">
        <NavButton item={SETTINGS_ITEM} active={page === "settings"} onSelect={navigate} />
        <p className="px-2.5 text-xs text-faint">Powered by Claude Haiku</p>
      </div>
    </aside>
  );
}
