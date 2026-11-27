import { useReducer, type ReactNode } from "react";
import { Copy, Minus, Moon, PanelLeft, Square, Sun, X } from "lucide-react";
import { useNav, useSettings } from "../lib/store";
import { applyTheme } from "../lib/appearance";
import { useMaximized, useResolvedTheme, windowAction, type WindowAction } from "../lib/shell";
import { cn } from "../lib/cn";
import { IconButton } from "./ui/Button";
import { SIDEBAR_ID } from "./Sidebar";

// Window chrome is measured in px on purpose: it must not grow with the Windows text-scale setting.
// Caption buttons span the full bar height and sit flush at the top-right, so the corner pixel hits Close.
function Caption({ label, action, danger, children }: { label: string; action: WindowAction; danger?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      tabIndex={-1}
      onClick={() => void windowAction(action)}
      className={cn(
        "flex h-[48px] w-[46px] items-center justify-center text-ink transition-colors duration-[83ms]",
        danger ? "hover:bg-[#c42b1c] hover:text-white active:bg-[#b3271a] active:text-white" : "hover:bg-hover active:bg-active",
      )}
    >
      {children}
    </button>
  );
}

/** 48px custom title bar on the canvas colour (the Rust side turns native decorations off). */
export function TitleBar({ showSidebarToggle = true }: { showSidebarToggle?: boolean }) {
  const toggleSidebar = useNav((s) => s.toggleSidebar);
  const collapsed = useNav((s) => s.sidebarCollapsed);
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  const resolved = useResolvedTheme();
  const maximized = useMaximized();
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  // Without loaded settings (error screen) the theme in effect is whatever is on <html>.
  const dark = settings ? resolved === "dark" : document.documentElement.dataset.theme === "dark";

  const toggleTheme = () => {
    const theme = dark ? "light" : "dark";
    if (settings) void update({ theme });
    else {
      applyTheme(theme); // nothing to persist yet: apply directly (keeps the accent source)
      rerender();
    }
  };

  return (
    <div data-tauri-drag-region className="flex h-[48px] shrink-0 items-start justify-between pl-3">
      <div data-tauri-drag-region className="flex h-[48px] items-center gap-1">
        {showSidebarToggle && (
          <IconButton label="Toggle sidebar" onClick={toggleSidebar} aria-expanded={!collapsed} aria-controls={SIDEBAR_ID} className="[&_svg]:size-5">
            <PanelLeft strokeWidth={1.5} />
          </IconButton>
        )}
      </div>
      <div data-tauri-drag-region className="flex items-start">
        <div data-tauri-drag-region className="flex h-[48px] items-center pr-2">
          <IconButton label={dark ? "Switch to light theme" : "Switch to dark theme"} onClick={toggleTheme} className="[&_svg]:size-5">
            {dark ? <Sun strokeWidth={1.5} /> : <Moon strokeWidth={1.5} />}
          </IconButton>
        </div>
        <Caption label="Minimize" action="minimize">
          <Minus size={16} strokeWidth={1.25} />
        </Caption>
        <Caption label={maximized ? "Restore" : "Maximize"} action="toggleMaximize">
          {maximized ? <Copy size={13} strokeWidth={1.25} /> : <Square size={12} strokeWidth={1.25} />}
        </Caption>
        <Caption label="Close" action="close" danger>
          <X size={16} strokeWidth={1.25} />
        </Caption>
      </div>
    </div>
  );
}
