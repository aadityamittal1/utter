import { useCallback, useEffect, useState } from "react";
import { KeyRound, Lightbulb } from "lucide-react";
import { ipc } from "../lib/ipc";
import { useNav, useSettings } from "../lib/store";
import { useBackendEvent } from "../lib/useBackendEvent";
import { formatNumber, formatTime, relativeDay } from "../lib/format";
import type { ApiKeyStatus, HistoryItem, Insights, Action } from "../lib/types";
import { Button, Card, Chord, PageHeader, SkeletonRows } from "../components/ui";
import { CATEGORY_LABEL } from "./parts/shared";

const SHORTCUT_ROWS: { action: Action; label: string }[] = [
  { action: "dictate", label: "Hold to dictate" },
  { action: "handsFree", label: "Hands-free (toggle)" },
  { action: "dictateEnhance", label: "Dictate and enhance" },
  { action: "command", label: "Voice command" },
];

const TIPS = [
  { title: "Snippets", body: "Say a short trigger like \"my address\" and Utter types the full text for you. Add them on the Snippets page." },
  { title: "Dictate and enhance", body: "Hold the enhance shortcut to have Claude tighten your wording as you speak. Great for emails and messages." },
  { title: "Command mode", body: "Select text, hold the command shortcut and say \"make this friendlier\" to rewrite it in place." },
  { title: "Dictionary", body: "Names and jargon misheard? Add them to the Dictionary and they will be spelled right every time." },
];

function greeting(hour: number): string {
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <Card className="px-5 py-4">
      <div className="text-[12px] text-muted">{label}</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="font-display text-[38px] leading-none tabular-nums text-ink">{value}</span>
        {unit && <span className="text-[13px] text-muted">{unit}</span>}
      </div>
    </Card>
  );
}

export default function Home() {
  const settings = useSettings((s) => s.settings);
  const navigate = useNav((s) => s.navigate);
  const [stats, setStats] = useState<Insights | null>(null);
  const [recent, setRecent] = useState<HistoryItem[] | null>(null);
  const [key, setKey] = useState<ApiKeyStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tip, setTip] = useState(() => Math.floor(Math.random() * TIPS.length));

  const load = useCallback(() => {
    Promise.all([ipc.insightsGet(), ipc.historyList(undefined, 5, 0), ipc.apiKeyStatus()])
      .then(([i, h, k]) => {
        setStats(i);
        setRecent(h);
        setKey(k);
        setError(null);
      })
      .catch((e) => setError(String(e)));
  }, []);
  useEffect(load, [load]);
  useBackendEvent("history://changed", load);

  const name = settings?.userName?.trim();
  const title = `${greeting(new Date().getHours())}${name ? `, ${name}` : ""}`;
  const t = TIPS[tip];

  return (
    <>
      <PageHeader title={title} description="Hold your shortcut, speak, let go. Your words appear wherever you were typing." />
      <div className="flex flex-col gap-6 pb-10">
        {key && !key.set && (
          <div className="flex items-center gap-4 rounded-card border border-line bg-accent-soft px-5 py-4">
            <KeyRound size={18} className="shrink-0 text-accent" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-ink">Set up your API key</div>
              <div className="text-[13px] text-muted">Dictation works without it. Add a key to unlock enhance, commands and transforms.</div>
            </div>
            <Button variant="primary" onClick={() => navigate("settings")}>
              Add key
            </Button>
          </div>
        )}

        <section aria-label="Shortcuts" className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
          {SHORTCUT_ROWS.map((r) => (
            <div key={r.action} className="flex items-center justify-between gap-4 border-b border-line pb-3">
              <span className="text-[13px] text-muted">{r.label}</span>
              <Chord chord={settings?.shortcuts[r.action]?.[0]} />
            </div>
          ))}
        </section>

        {error && !stats ? (
          <Card className="flex items-center justify-between px-5 py-4 text-[13px] text-muted">
            <span>Couldn't load your stats: {error}</span>
            <Button size="sm" onClick={load}>
              Try again
            </Button>
          </Card>
        ) : (
          <section aria-label="This week" className="grid gap-4 sm:grid-cols-3">
            {stats ? (
              <>
                <Stat label="Words this week" value={formatNumber(stats.weekWords)} />
                <Stat label="Average speed" value={formatNumber(stats.avgWpm)} unit="wpm" />
                <Stat label="Current streak" value={formatNumber(stats.currentStreak)} unit={stats.currentStreak === 1 ? "day" : "days"} />
              </>
            ) : (
              [0, 1, 2].map((i) => <div key={i} className="skeleton h-[86px]" />)
            )}
          </section>
        )}

        <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
          <section aria-label="Recent activity">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-[15px] font-semibold text-ink">Recent</h2>
              <button type="button" onClick={() => navigate("history")} className="rounded text-[13px] text-accent hover:underline">
                See all
              </button>
            </div>
            {recent === null ? (
              <SkeletonRows rows={3} />
            ) : recent.length === 0 ? (
              <p className="rounded-card border border-dashed border-line-strong px-5 py-8 text-center text-[13px] text-muted">
                Nothing yet. Hold your dictate shortcut in any app and start talking.
              </p>
            ) : (
              <ul className="divide-y divide-line rounded-card border border-line bg-surface">
                {recent.map((h) => (
                  <li key={h.id} className="px-4 py-3">
                    <p className="line-clamp-2 text-sm text-ink">{h.finalText || h.rawText || "(empty)"}</p>
                    <p className="mt-1 text-xs text-faint">
                      {h.appName} · {CATEGORY_LABEL[h.category]} · {relativeDay(h.createdAt)}, {formatTime(h.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <aside aria-label="Tip">
            <Card className="px-5 py-4">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                <Lightbulb size={15} className="text-accent" aria-hidden />
                Tip: {t.title}
              </div>
              <p className="mt-2 text-[13px] leading-relaxed text-muted">{t.body}</p>
              <button
                type="button"
                onClick={() => setTip((tip + 1) % TIPS.length)}
                className="mt-3 rounded text-[13px] text-accent hover:underline"
              >
                Next tip
              </button>
            </Card>
          </aside>
        </div>
      </div>
    </>
  );
}
