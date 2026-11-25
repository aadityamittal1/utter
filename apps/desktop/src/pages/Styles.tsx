import { Lock, Sparkles } from "lucide-react";
import { Card, PageHeader, Switch } from "../components/ui";
import { cn } from "../lib/cn";
import { useNav, useSettings } from "../lib/store";
import { CATEGORIES, STYLE_KINDS, type Category, type CleanupLevel, type StyleKind } from "../lib/types";
import { allowedStyles, CATEGORY_HINTS, CATEGORY_LABELS, disabledReason, isStyleAllowed, nextStyle, renderExample, STYLE_LABELS } from "./parts/styles/examples";

const CLEANUP: { value: CleanupLevel; label: string; help: string }[] = [
  { value: "off", label: "Off", help: "Your words exactly as heard. Nothing is removed or fixed." },
  { value: "light", label: "Light", help: "Drops fillers like “um” and “uh”, and fixes capitals and punctuation." },
  { value: "medium", label: "Medium", help: "Also trims repeats and false starts, and fixes plain grammar slips." },
];

export default function Styles() {
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  const navigate = useNav((s) => s.navigate);
  if (!settings) return null;

  const setStyle = (c: Category, kind: StyleKind) => void update({ styles: { ...settings.styles, [c]: kind } });
  const toggleEnhance = (c: Category, on: boolean) =>
    void update({ autoEnhance: on ? [...settings.autoEnhance.filter((x) => x !== c), c] : settings.autoEnhance.filter((x) => x !== c) });

  const current = CLEANUP.find((c) => c.value === settings.cleanupLevel);

  return (
    <div>
      <PageHeader title="Styles" description="Utter adapts your tone to where you are typing. Choose how each kind of app should sound." />

      <section aria-labelledby="cleanup-h" className="rounded-card border border-line bg-surface p-5">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h2 id="cleanup-h" className="text-[15px] font-semibold text-ink">
              Cleanup
            </h2>
            <p className="mt-0.5 max-w-[52ch] text-[13px] text-muted" aria-live="polite">
              {current?.help}
            </p>
          </div>
          <div role="radiogroup" aria-labelledby="cleanup-h" className="inline-flex shrink-0 rounded-control border border-line bg-muted-surface p-0.5">
            {CLEANUP.map((c) => {
              const on = settings.cleanupLevel === c.value;
              return (
                <button
                  key={c.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => void update({ cleanupLevel: c.value })}
                  className={cn(
                    "h-8 min-w-[72px] rounded-[6px] px-3 text-[13px] font-medium transition-colors",
                    on ? "bg-surface text-ink shadow-[0_1px_2px_var(--shadow-color)]" : "text-muted hover:text-ink",
                  )}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <div className="mt-8 flex items-end justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">Tone by app type</h2>
          <p className="mt-0.5 text-[13px] text-muted">Each example is the same request, written in that style.</p>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-4">
        {CATEGORIES.map((cat) => {
          const selected = settings.styles[cat];
          const enhance = settings.autoEnhance.includes(cat);
          const stop = isStyleAllowed(cat, selected) ? selected : allowedStyles(cat)[0]; // the one tab stop
          return (
            <Card key={cat} className="p-5">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-ink">{CATEGORY_LABELS[cat]}</h3>
                  <p className="text-xs text-muted">{CATEGORY_HINTS[cat]}</p>
                </div>
                <label className="flex shrink-0 items-center gap-2.5 text-[13px] text-ink">
                  <Sparkles size={14} aria-hidden className={enhance ? "text-accent" : "text-faint"} />
                  Always enhance
                  <Switch checked={enhance} onChange={(on) => toggleEnhance(cat, on)} label={`Always enhance in ${CATEGORY_LABELS[cat]}`} />
                </label>
              </div>

              <div
                role="radiogroup"
                aria-label={`${CATEGORY_LABELS[cat]} style`}
                className="mt-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4"
                onKeyDown={(e) => {
                  const next = nextStyle(cat, selected, e.key);
                  if (!next) return;
                  e.preventDefault();
                  setStyle(cat, next);
                  e.currentTarget.querySelector<HTMLElement>(`[data-kind="${next}"]`)?.focus();
                }}
              >
                {STYLE_KINDS.map((kind) => {
                  const reason = disabledReason(cat, kind);
                  const on = selected === kind && !reason;
                  const tabbable = !reason && kind === stop;
                  return (
                    <button
                      key={kind}
                      type="button"
                      role="radio"
                      data-kind={kind}
                      tabIndex={tabbable ? 0 : -1}
                      aria-checked={on}
                      aria-disabled={!!reason}
                      title={reason ?? undefined}
                      onClick={() => !reason && setStyle(cat, kind)}
                      className={cn(
                        "flex min-h-[104px] flex-col items-start rounded-control border p-3 text-left transition-colors",
                        reason
                          ? "cursor-not-allowed border-dashed border-line bg-transparent opacity-60"
                          : on
                            ? "border-ember bg-accent-soft"
                            : "border-line bg-bg hover:border-line-strong hover:bg-hover",
                      )}
                    >
                      <span className="flex w-full items-center justify-between text-[13px] font-semibold text-ink">
                        {STYLE_LABELS[kind]}
                        {reason && <Lock size={12} aria-hidden className="text-faint" />}
                      </span>
                      <span className="mt-1.5 text-[12.5px] leading-snug text-muted">{reason ? reason : renderExample(kind, cat)}</span>
                    </button>
                  );
                })}
              </div>
            </Card>
          );
        })}
      </div>

      <p className="mt-6 max-w-[70ch] text-[13px] text-muted">
        “Always enhance” sends your dictation through Claude in that app type, as if you had held the enhance shortcut. Utter finds the app type from the window you are typing in
        {settings.contextAwareness ? "" : " (context awareness is currently off)"}. It looks at the app and window title only, never at what is on screen.{" "}
        <button type="button" onClick={() => navigate("settings")} className="font-medium text-accent underline underline-offset-2 hover:no-underline">
          See Privacy in Settings
        </button>
      </p>
    </div>
  );
}
