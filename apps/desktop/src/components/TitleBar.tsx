import type { ReactNode } from "react";
import { Copy, Minus, Moon, PanelLeft, Square, Sun, X } from "lucide-react";
import { useNav, useSettings } from "../lib/store";
import { useMaximized, useResolvedTheme, windowAction, type WindowAction } from "../lib/shell";
import { cn } from "../lib/cn";
import { IconButton } from "./ui/Button";

function Caption({ label, action, danger, children }: { label: string; action: WindowAction; danger?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      tabIndex={-1}
      onClick={() => void windowAction(action)}
      className={cn(
        "flex h-8 w-[46px] items-center justify-center text-ink transition-colors duration-[83ms]",
        danger ? "hover:bg-[#c42b1c] hover:text-white" : "hover:bg-hover",
      )}
    >
      {children}
    </button>
  );
}

/** 48px custom title bar on the canvas colour (the Rust side turns native decorations off). */
export function TitleBar() {
  const toggleSidebar = useNav((s) => s.toggleSidebar);
  const collapsed = useNav((s) => s.sidebarCollapsed);
  const update = useSettings((s) => s.update);
  const resolved = useResolvedTheme();
  const maximized = useMaximized();
  const dark = resolved === "dark";

  return (
    <div data-tauri-drag-region className="flex h-12 shrink-0 items-center justify-between pl-3">
      <div data-tauri-drag-region className="flex items-center gap-1">
        <IconButton label={collapsed ? "Show sidebar" : "Hide sidebar"} onClick={toggleSidebar} aria-expanded={!collapsed}>
          <PanelLeft size={20} strokeWidth={1.5} />
        </IconButton>
      </div>
      <div data-tauri-drag-region className="flex items-center">
        <IconButton label={dark ? "Switch to light theme" : "Switch to dark theme"} onClick={() => void update({ theme: dark ? "light" : "dark" })} className="mr-2">
          {dark ? <Sun size={20} strokeWidth={1.5} /> : <Moon size={20} strokeWidth={1.5} />}
        </IconButton>
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
