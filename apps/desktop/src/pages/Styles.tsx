import { useState } from "react";
import { Card, Label, PageHeader, Radio, RadioGroup, SettingRow, Switch } from "../components/ui";
import { useNav, useSettings } from "../lib/store";
import type { Category, CleanupLevel, StyleKind } from "../lib/types";
import { Banner } from "./parts/home/Banner";
import { PageTabs } from "./parts/dictionary/ListParts";
import { StyleCard } from "./parts/styles/StyleCard";
import { allowedStyles, BANNER_TITLES, CATEGORY_APPS, CATEGORY_LABELS, CONTEXT_TABS, ENHANCE_WHERE, isStyleAllowed, nextStyle, type ContextTab } from "./parts/styles/examples";

const CLEANUP: { value: CleanupLevel; label: string; help: string }[] = [
  { value: "off", label: "Off", help: "Your words exactly as heard. Nothing is removed or fixed." },
  { value: "light", label: "Light", help: "Drops fillers like “um” and “uh”, and fixes capitals and punctuation." },
  { value: "medium", label: "Medium", help: "Also trims repeats and false starts, and fixes plain grammar slips." },
];

export default function Styles() {
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  const openSettings = useNav((s) => s.openSettings);
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
          <RadioGroup aria-label="Other app types" orientation="horizontal" value={otherCat} onChange={(v) => setOtherCat(v as Category)} className="flex-wrap gap-x-6 gap-y-2">
            {def.categories.map((c) => (
              <Radio key={c} value={c} className="flex-row items-center gap-2">
                <Radio.Control>
                  <Radio.Indicator />
                </Radio.Control>
                <Radio.Content>
                  <Label>{CATEGORY_LABELS[c]}</Label>
                </Radio.Content>
              </Radio>
            ))}
          </RadioGroup>
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
          Utter picks the style from the app you dictate into.
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
          <SettingRow title={`Always enhance in ${ENHANCE_WHERE[cat]}`} description="Sends every dictation here through Claude, as if you had held the enhance shortcut.">
            <Switch checked={enhance} onChange={toggleEnhance} label={`Always enhance in ${ENHANCE_WHERE[cat]}`} />
          </SettingRow>
          <SettingRow title="Cleanup" description={current?.help}>
            <RadioGroup aria-label="Cleanup level" orientation="horizontal" value={settings.cleanupLevel} onChange={(v) => void update({ cleanupLevel: v as CleanupLevel })} className="gap-x-5">
              {CLEANUP.map((c) => (
                <Radio key={c.value} value={c.value} className="flex-row items-center gap-2">
                  <Radio.Control>
                    <Radio.Indicator />
                  </Radio.Control>
                  <Radio.Content>
                    <Label>{c.label}</Label>
                  </Radio.Content>
                </Radio>
              ))}
            </RadioGroup>
          </SettingRow>
        </Card>
      </div>

      <p className="mt-6 max-w-[70ch] text-caption text-muted">
        Utter finds the app type from the window you are typing in
        {settings.contextAwareness ? "" : " (context awareness is currently off)"}. It looks at the app and window title only, never at what is on screen.{" "}
        <button type="button" onClick={() => openSettings("privacy")} className="font-semibold text-ember-text underline underline-offset-2 hover:no-underline">
          See Privacy in Settings
        </button>
      </p>
    </div>
  );
}
