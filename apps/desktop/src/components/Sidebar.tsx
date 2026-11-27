import type { LucideIcon } from "lucide-react";
import { BookA, ChartColumn, CircleHelp, History, House, Palette, Settings, StickyNote, TextCursorInput, WandSparkles } from "lucide-react";
import { Tooltip } from "@heroui/react";
import { useNav } from "../lib/store";
import { HELP_URL, openExternal } from "../lib/shell";
import type { Page } from "../lib/types";
import { cn } from "../lib/cn";
import { Logo, LogoMark } from "./Logo";

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

const ROW =
  "group flex h-10 w-full items-center gap-3 rounded-control px-3 text-nav transition-colors duration-[167ms] ease-fluent";

function NavRow({ icon: Icon, label, active, collapsed, onPress }: { icon: LucideIcon; label: string; active?: boolean; collapsed: boolean; onPress: () => void }) {
  const button = (
    <button
      type="button"
      onClick={onPress}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? label : undefined}
      className={cn(ROW, collapsed && "justify-center px-0", active ? "bg-nav-active text-ink" : "text-muted hover:bg-hover hover:text-ink")}
    >
      <Icon size={20} strokeWidth={1.5} aria-hidden className="shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
    </button>
  );
  if (!collapsed) return button;
  return (
    <Tooltip delay={300}>
      {button}
      <Tooltip.Content placement="right">{label}</Tooltip.Content>
    </Tooltip>
  );
}

/** Sits on the canvas (no panel of its own): 220px, or a 64px icon rail when collapsed. */
export function Sidebar() {
  const page = useNav((s) => s.page);
  const navigate = useNav((s) => s.navigate);
  const openSettings = useNav((s) => s.openSettings);
  const collapsed = useNav((s) => s.sidebarCollapsed);

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col pb-3 pl-3 pr-2 transition-[width] duration-[250ms] ease-fluent",
        collapsed ? "w-[76px]" : "w-[220px]",
      )}
    >
      <div className={cn("flex h-10 items-center pb-2 pt-1", collapsed ? "justify-center" : "px-3")}>
        {collapsed ? <LogoMark width={32} /> : <Logo height={17} />}
      </div>
      <nav aria-label="Main" className="mt-3 flex min-h-0 flex-1 flex-col">
        <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
          {NAV_ITEMS.map((item) => (
            <NavRow key={item.page} icon={item.icon} label={item.label} active={page === item.page} collapsed={collapsed} onPress={() => navigate(item.page)} />
          ))}
        </div>
        <div className="mt-3 flex flex-col gap-0.5 border-t border-line pt-3">
          <NavRow icon={SETTINGS_ITEM.icon} label={SETTINGS_ITEM.label} active={page === "settings"} collapsed={collapsed} onPress={() => openSettings()} />
          <NavRow icon={CircleHelp} label="Help" collapsed={collapsed} onPress={() => void openExternal(HELP_URL)} />
        </div>
      </nav>
    </aside>
  );
}
