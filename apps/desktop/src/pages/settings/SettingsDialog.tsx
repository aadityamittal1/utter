import { useEffect, useRef, useState, type ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import { AudioLines, Info, Laptop, ShieldCheck, SlidersHorizontal, Sparkles } from "lucide-react";
import { Modal as HeroModal } from "@heroui/react";
import { ipc } from "../../lib/ipc";
import { cn } from "../../lib/cn";
import { TITLEBAR_CLEAR } from "../../components/ui/Modal";
import { useNav, type SettingsSection } from "../../lib/store";
import About from "./About";
import AI from "./AI";
import General from "./General";
import Models from "./Models";
import Privacy from "./Privacy";
import System from "./System";

interface Item {
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
  Component: ComponentType;
}

const GROUPS: Array<{ label: string; items: Item[] }> = [
  {
    label: "Settings",
    items: [
      { id: "general", label: "General", icon: SlidersHorizontal, Component: General },
      { id: "system", label: "System", icon: Laptop, Component: System },
      { id: "ai", label: "AI", icon: Sparkles, Component: AI },
      { id: "speech", label: "Speech model", icon: AudioLines, Component: Models },
      { id: "privacy", label: "Privacy & data", icon: ShieldCheck, Component: Privacy },
    ],
  },
  { label: "About", items: [{ id: "about", label: "About Utter", icon: Info, Component: About }] },
];
const ALL = GROUPS.flatMap((g) => g.items);

function NavButton({ item, active, onPress }: { item: Item; active: boolean; onPress: () => void }) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={onPress}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-10 w-full items-center gap-3 rounded-control px-3 text-nav transition-colors duration-[167ms] ease-fluent",
        active ? "bg-nav-active text-ink" : "text-muted hover:bg-hover hover:text-ink",
      )}
    >
      <Icon size={20} strokeWidth={1.5} aria-hidden className="shrink-0" />
      <span className="truncate">{item.label}</span>
    </button>
  );
}

/** Settings: a large dialog with its own nav (opened from the sidebar, the tray or any "Add key" link). */
export default function SettingsDialog() {
  const open = useNav((s) => s.settingsOpen);
  const section = useNav((s) => s.settingsSection);
  const close = useNav((s) => s.closeSettings);
  const setSection = useNav((s) => s.setSettingsSection);
  const [version, setVersion] = useState<string | null>(null);
  const pane = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || version) return;
    ipc
      .appInfo()
      .then((i) => setVersion(i.version))
      .catch(() => undefined);
  }, [open, version]);

  // A new section starts at the top.
  useEffect(() => {
    if (pane.current) pane.current.scrollTop = 0;
  }, [section]);

  const Active = (ALL.find((i) => i.id === section) ?? ALL[0]).Component;

  return (
    <HeroModal.Backdrop className={TITLEBAR_CLEAR} isOpen={open} onOpenChange={(o) => !o && close()}>
      <HeroModal.Container>
        <HeroModal.Dialog
          aria-label="Settings"
          className="h-[min(680px,calc(100dvh-48px))] w-[min(1000px,calc(100vw-48px))] max-w-none overflow-hidden rounded-card p-0"
        >
          <div className="flex h-full min-h-0">
            <aside className="flex w-[232px] shrink-0 flex-col bg-bg px-3 pb-4 pt-5">
              <nav aria-label="Settings sections" className="-mx-1 flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-1">
                {GROUPS.map((g) => (
                  <div key={g.label}>
                    <div id={`settings-group-${g.label}`} className="px-3 pb-2 text-group-label text-faint">
                      {g.label}
                    </div>
                    <ul aria-labelledby={`settings-group-${g.label}`} className="flex flex-col gap-0.5">
                      {g.items.map((item) => (
                        <li key={item.id}>
                          <NavButton item={item} active={item.id === section} onPress={() => setSection(item.id)} />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </nav>
              <div className="px-3 pt-3 text-caption text-faint tabular-nums">Utter {version ? `v${version}` : ""}</div>
            </aside>
            <div ref={pane} className="min-w-0 flex-1 overflow-y-auto overscroll-contain px-10 pb-10 pt-12">
              <Active key={section} />
            </div>
          </div>
          <HeroModal.CloseTrigger />
        </HeroModal.Dialog>
      </HeroModal.Container>
    </HeroModal.Backdrop>
  );
}
