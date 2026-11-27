import { useCallback, useEffect, useRef, useState } from "react";
import { KeyRound, Lightbulb } from "lucide-react";
import { ipc } from "../lib/ipc";
import { toast, useNav, useSettings } from "../lib/store";
import { useBackendEvent } from "../lib/useBackendEvent";
import { formatNumber } from "../lib/format";
import type { Action, ApiKeyStatus, HistoryItem, Insights } from "../lib/types";
import { Button, Card, Chord, SkeletonRows } from "../components/ui";
import { createLatestGuard } from "./parts/history/latest";
import { DayList } from "./parts/history/DayList";
import { Banner, BANNER_BUTTON, EmberWaveform } from "./parts/home/Banner";
import { formatCompact, homeTitle } from "./parts/home/stats";

const SHORTCUT_ROWS: { action: Action; label: string }[] = [
  { action: "dictate", label: "Hold to dictate" },
  { action: "handsFree", label: "Hands-free" },
  { action: "dictateEnhance", label: "Dictate and enhance" },
  { action: "command", label: "Voice command" },
];

const TIPS = [
  { title: "Snippets", body: "Say a short trigger like “my address” and Utter types the full text for you. Add them on the Snippets page." },
  { title: "Dictate and enhance", body: "Hold the enhance shortcut to have Claude tighten your wording as you speak. Good for emails and messages." },
  { title: "Command mode", body: "Select text, hold the command shortcut and say “make this friendlier” to rewrite it in place." },
  { title: "Dictionary", body: "Names and jargon misheard? Add them to the Dictionary and they will be spelled right every time." },
];

const BANNER_KEY = "utter.home.banner.transforms";
const readDismissed = (): boolean => {
  try {
    return localStorage.getItem(BANNER_KEY) === "1";
  } catch {
    return false;
  }
};

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-serif-figure text-ink">{value}</span>
      <span className="text-body text-muted">{label}</span>
    </div>
  );
}

export default function Home() {
  const settings = useSettings((s) => s.settings);
  const navigate = useNav((s) => s.navigate);
  const openSettings = useNav((s) => s.openSettings);
  const [stats, setStats] = useState<Insights | null>(null);
  const [recent, setRecent] = useState<HistoryItem[] | null>(null);
  const [key, setKey] = useState<ApiKeyStatus | null>(null);
  // Each section loads independently: `settled` flips once the first attempt finished, so nothing shows a skeleton forever.
  const [settled, setSettled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tip, setTip] = useState(() => Math.floor(Math.random() * TIPS.length));
  const [bannerGone, setBannerGone] = useState(readDismissed);
  const guard = useRef(createLatestGuard());
  const loaded = useRef(false);

  const load = useCallback(() => {
    const isLatest = guard.current.next();
    Promise.allSettled([ipc.insightsGet(), ipc.historyList(undefined, 20, 0), ipc.apiKeyStatus()]).then(([i, h, k]) => {
      if (!isLatest()) return;
      if (i.status === "fulfilled") setStats(i.value);
      if (h.status === "fulfilled") setRecent(h.value);
      if (k.status === "fulfilled") setKey(k.value);
      const failed = [i, h, k].find((r): r is PromiseRejectedResult => r.status === "rejected");
      if (failed) {
        if (loaded.current) toast.error(`Couldn't refresh: ${String(failed.reason)}`);
        else setError(String(failed.reason));
      } else setError(null);
      loaded.current = true;
      setSettled(true);
    });
  }, []);
  useEffect(load, [load]);
  useBackendEvent("history://changed", load);

  const dismissBanner = () => {
    setBannerGone(true);
    try {
      localStorage.setItem(BANNER_KEY, "1");
    } catch {
      /* private window or blocked storage: it comes back next visit */
    }
  };

  const t = TIPS[tip];

  return (
    <>
      <h1 className="pb-6 text-title text-ink">{homeTitle(settings?.userName)}</h1>

      <div className="@container">
      <div className="grid items-start gap-6 @min-[860px]:grid-cols-[minmax(0,1fr)_280px]">
        <div className="flex min-w-0 flex-col gap-8">
          {key && !key.set && (
            <div className="flex items-center gap-4 rounded-card border border-line bg-muted-surface px-5 py-4">
              <KeyRound size={20} strokeWidth={1.5} className="shrink-0 text-muted" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="text-body-strong text-ink">Set up your API key</div>
                <div className="text-caption text-muted">Dictation works without it. Add a key to unlock enhance, commands and transforms.</div>
              </div>
              <Button variant="primary" onClick={() => openSettings("ai")}>
                Add key
              </Button>
            </div>
          )}

          {!bannerGone && (
            <Banner
              title="Rewrite text anywhere"
              art={<EmberWaveform />}
              onDismiss={dismissBanner}
              actions={
                <Button className={BANNER_BUTTON} onClick={() => navigate("transforms")}>
                  Open Transforms
                </Button>
              }
            >
              One shortcut rewrites selected text.
            </Banner>
          )}

          <section aria-label="Recent dictations">
            {recent === null ? (
              settled ? (
                <p className="rounded-card border border-dashed border-line-strong px-5 py-8 text-center text-body text-muted">
                  Couldn't load recent dictations.{" "}
                  <button type="button" onClick={load} className="rounded text-ember-text hover:underline">
                    Try again
                  </button>
                </p>
              ) : (
                <SkeletonRows rows={3} />
              )
            ) : recent.length === 0 ? (
              <p className="rounded-card border border-dashed border-line-strong px-5 py-10 text-center text-body text-muted">Nothing yet. Hold your dictate shortcut in any app and start talking.</p>
            ) : (
              <DayList
                items={recent}
                onChanged={load}
                firstGroupAction={
                  <button type="button" onClick={() => navigate("history")} className="rounded text-caption text-ember-text hover:underline">
                    See all history
                  </button>
                }
              />
            )}
          </section>
        </div>

        <aside aria-label="Summary" className="flex flex-col gap-4">
          {settled && !stats ? (
            <Card className="flex flex-col gap-3 px-5 py-4 text-body text-muted">
              <span>Couldn't load your stats{error ? `: ${error}` : ""}</span>
              <Button size="sm" onClick={load}>
                Try again
              </Button>
            </Card>
          ) : (
            <section aria-label="Your numbers" className="flex flex-col gap-4 rounded-card bg-muted-surface px-6 py-6">
              {stats ? (
                <>
                  <Figure value={formatCompact(stats.totalWords)} label="total words" />
                  <Figure value={formatNumber(stats.avgWpm)} label="wpm" />
                  <Figure value={formatNumber(stats.currentStreak)} label="day streak" />
                </>
              ) : (
                <div className="skeleton h-28" />
              )}
            </section>
          )}

          <section aria-label="Tip">
          <Card className="px-5 py-4">
            <div className="flex items-center gap-2 text-body-strong text-ink">
              <Lightbulb size={16} strokeWidth={1.5} className="text-muted" aria-hidden />
              {t.title}
            </div>
            <p className="mt-2 text-body text-muted">{t.body}</p>
            <button type="button" onClick={() => setTip((tip + 1) % TIPS.length)} className="mt-3 rounded text-caption text-ember-text hover:underline">
              Next tip
            </button>
          </Card>
          </section>

          <section aria-label="Shortcuts" className="flex flex-col gap-3 px-1 pt-2">
            {SHORTCUT_ROWS.map((r) => (
              <div key={r.action} className="flex items-center justify-between gap-3">
                <span className="text-caption text-muted">{r.label}</span>
                <Chord chord={settings?.shortcuts[r.action]?.[0]} />
              </div>
            ))}
          </section>
        </aside>
      </div>
      </div>
    </>
  );
}
