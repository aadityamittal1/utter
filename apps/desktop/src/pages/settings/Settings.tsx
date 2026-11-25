import { useRef, useState, type ComponentType, type KeyboardEvent } from "react";
import { PageHeader } from "../../components/ui";
import { cn } from "../../lib/cn";
import About from "./About";
import AI from "./AI";
import General from "./General";
import Microphone from "./Microphone";
import Models from "./Models";
import Privacy from "./Privacy";
import Shortcuts from "./Shortcuts";

const TABS: Array<{ id: string; label: string; Component: ComponentType }> = [
  { id: "general", label: "General", Component: General },
  { id: "shortcuts", label: "Shortcuts", Component: Shortcuts },
  { id: "microphone", label: "Microphone", Component: Microphone },
  { id: "models", label: "Language & model", Component: Models },
  { id: "claude", label: "Claude", Component: AI },
  { id: "privacy", label: "Privacy", Component: Privacy },
  { id: "about", label: "About", Component: About },
];

const TAB_KEY = "utter.settingsTab";

function initialTab(): string {
  try {
    const t = sessionStorage.getItem(TAB_KEY);
    if (t && TABS.some((x) => x.id === t)) return t;
  } catch {
    /* storage unavailable */
  }
  return "general";
}

export default function Settings() {
  const [tab, setTab] = useState(initialTab);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const active = TABS.find((t) => t.id === tab) ?? TABS[0];
  const Active = active.Component;

  const select = (id: string, focus = false) => {
    setTab(id);
    try {
      sessionStorage.setItem(TAB_KEY, id);
    } catch {
      /* ignore */
    }
    if (focus) refs.current[id]?.focus();
  };

  const onKey = (e: KeyboardEvent, i: number) => {
    const n = TABS.length;
    const to = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    select(TABS[to].id, true);
  };

  return (
    <div>
      <PageHeader title="Settings" description="Shortcuts, microphone, models and privacy." />
      <div role="tablist" aria-label="Settings sections" className="mb-6 flex flex-wrap gap-x-1 border-b border-line">
        {TABS.map((t, i) => {
          const on = t.id === active.id;
          return (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[t.id] = el;
              }}
              id={`settings-tab-${t.id}`}
              role="tab"
              type="button"
              aria-selected={on}
              aria-controls="settings-panel"
              tabIndex={on ? 0 : -1}
              onClick={() => select(t.id)}
              onKeyDown={(e) => onKey(e, i)}
              className={cn(
                "relative -mb-px h-10 rounded-t-control px-3 text-sm font-medium transition-colors",
                on ? "text-ink" : "text-muted hover:text-ink",
              )}
            >
              {t.label}
              {on && <span aria-hidden className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-ember" />}
            </button>
          );
        })}
      </div>
      <div id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${active.id}`}>
        <Active />
      </div>
    </div>
  );
}
