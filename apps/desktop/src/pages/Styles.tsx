import { useState } from "react";
import { Card, PageHeader, SettingRow, Switch, Tabs } from "../components/ui";
import { cn } from "../lib/cn";
import { useNav, useSettings } from "../lib/store";
import type { Category, CleanupLevel, StyleKind } from "../lib/types";
import { Banner } from "./parts/home/Banner";
import { PageTabs } from "./parts/dictionary/ListParts";
import { StyleCard } from "./parts/styles/StyleCard";
import { allowedStyles, BANNER_TITLES, CATEGORY_APPS, CATEGORY_LABELS, CONTEXT_TABS, isStyleAllowed, nextStyle, type ContextTab } from "./parts/styles/examples";

const CLEANUP: { value: CleanupLevel; label: string; help: string }[] = [
  { value: "off", label: "Off", help: "Your words exactly as heard. Nothing is removed or fixed." },
  { value: "light", label: "Light", help: "Drops fillers like “um” and “uh”, and fixes capitals and punctuation." },
  { value: "medium", label: "Medium", help: "Also trims repeats and false starts, and fixes plain grammar slips." },
];

export default function Styles() {
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  const navigate = useNav((s) => s.navigate);
  const [tab, setTab] = useState<ContextTab>("personal");
  const [otherCat, setOtherCat] = useState<Category>("other");
  if (!settings) return null;

  const def = CONTEXT_TABS.find((t) => t.id === tab) ?? CONTEXT_TABS[0];
  const cat: Category = def.categories.length > 1 ? otherCat : def.categories[0];
  const selected = settings.styles[cat];
  const enhance = settings.autoEnhance.includes(cat);
  const stop = isStyleAllowed(cat, selected) ? selected : allowedStyles(cat)[0]; // the one tab stop
  const initial = (settings.userName.trim()[0] ?? "Y").toUpperCase();

  const setStyle = (kind: StyleKind) => void update({ styles: { ...settings.styles, [cat]: kind } });
  const toggleEnhance = (on: boolean) => void update({ autoEnhance: on ? [...settings.autoEnhance.filter((x) => x !== cat), cat] : settings.autoEnhance.filter((x) => x !== cat) });
  const current = CLEANUP.find((c) => c.value === settings.cleanupLevel);

  return (
    <div>
      <PageHeader title="Styles" />

      <div className="border-b border-line">
        <PageTabs label="App type" tabs={CONTEXT_TABS.map((t) => ({ id: t.id, label: t.label }))} value={tab} onChange={(t) => setTab(t as ContextTab)} />
      </div>

      <div className="mt-6 flex flex-col gap-6">
        {def.categories.length > 1 && (
          <div role="radiogroup" aria-label="App type" className="flex flex-wrap gap-2">
            {def.categories.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={otherCat === c}
                onClick={() => setOtherCat(c)}
                className={cn(
                  "h-8 rounded-full border px-3 text-body transition-colors duration-[var(--dur-fast)] ease-fluent",
                  otherCat === c ? "border-transparent bg-ink-fill text-on-ink" : "border-line bg-surface text-muted hover:bg-hover hover:text-ink",
                )}
              >
                {CATEGORY_LABELS[c]}
              </button>
            ))}
          </div>
        )}

        <Banner
          title={BANNER_TITLES[cat]}
          art={
            <ul className="flex max-w-[260px] flex-wrap justify-end gap-2" aria-label="Example apps">
              {CATEGORY_APPS[cat].map((a) => (
                <li key={a} className="rounded-full border border-on-banner/20 px-3 py-1 text-caption text-on-banner">
                  {a}
                </li>
              ))}
            </ul>
          }
        >
          Style formatting only applies in English. Utter picks the style from the app you are typing in.
        </Banner>

        <div
          role="radiogroup"
          aria-label={`${CATEGORY_LABELS[cat]} style`}
          className="grid grid-cols-1 gap-4 sm:grid-cols-3"
          onKeyDown={(e) => {
            const next = nextStyle(cat, selected, e.key);
            if (!next) return;
            e.preventDefault();
            setStyle(next);
            e.currentTarget.querySelector<HTMLElement>(`[data-kind="${next}"]`)?.focus();
          }}
        >
          {allowedStyles(cat).map((kind) => (
            <StyleCard key={kind} kind={kind} category={cat} selected={selected === kind} tabbable={kind === stop} initial={initial} onSelect={() => setStyle(kind)} />
          ))}
        </div>

        <Card className="divide-y divide-line px-5">
          <SettingRow title={`Always enhance in ${CATEGORY_LABELS[cat].toLowerCase()}`} description="Sends every dictation here through Claude, as if you had held the enhance shortcut.">
            <Switch checked={enhance} onChange={toggleEnhance} label={`Always enhance in ${CATEGORY_LABELS[cat]}`} />
          </SettingRow>
          <SettingRow title="Cleanup" description={current?.help}>
            <Tabs variant="primary" selectedKey={settings.cleanupLevel} onSelectionChange={(k) => void update({ cleanupLevel: String(k) as CleanupLevel })}>
              <Tabs.ListContainer>
                <Tabs.List aria-label="Cleanup level">
                  {CLEANUP.map((c) => (
                    <Tabs.Tab key={c.value} id={c.value} className="text-body-strong">
                      {c.label}
                      <Tabs.Indicator />
                    </Tabs.Tab>
                  ))}
                </Tabs.List>
              </Tabs.ListContainer>
            </Tabs>
          </SettingRow>
        </Card>
      </div>

      <p className="mt-6 max-w-[70ch] text-caption text-muted">
        Utter finds the app type from the window you are typing in
        {settings.contextAwareness ? "" : " (context awareness is currently off)"}. It looks at the app and window title only, never at what is on screen.{" "}
        <button type="button" onClick={() => navigate("settings")} className="text-body-strong text-ember-text underline underline-offset-2 hover:no-underline">
          See Privacy in Settings
        </button>
      </p>
    </div>
  );
}
