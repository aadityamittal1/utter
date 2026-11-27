import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Bot, ChartColumn, Code, FileText, Mail, MessageCircle, MessageSquare, Shapes } from "lucide-react";
import { toast } from "../lib/store";
import { createLatestGuard } from "./parts/history/latest";
import { ipc } from "../lib/ipc";
import { formatNumber, formatUsd } from "../lib/format";
import { useBackendEvent } from "../lib/useBackendEvent";
import type { Category, Insights as InsightsData, Usage } from "../lib/types";
import { Button, EmptyState, PageHeader, SkeletonRows } from "../components/ui";
import { cn } from "../lib/cn";
import { Heatmap } from "./parts/insights/Heatmap";
import { BarList } from "./parts/insights/BarList";
import { Gauge } from "./parts/insights/Gauge";
import { CATEGORY_LABEL } from "./parts/history/shared";

/** Top of the gauge scale. A fixed, honest scale: 200 words per minute is a fast speaker. */
const WPM_SCALE = 200;

const CATEGORY_ICON: Record<Category, ReactNode> = {
  email: <Mail size={20} strokeWidth={1.5} />,
  workChat: <MessageSquare size={20} strokeWidth={1.5} />,
  personalChat: <MessageCircle size={20} strokeWidth={1.5} />,
  aiPrompt: <Bot size={20} strokeWidth={1.5} />,
  code: <Code size={20} strokeWidth={1.5} />,
  document: <FileText size={20} strokeWidth={1.5} />,
  other: <Shapes size={20} strokeWidth={1.5} />,
};

function InsightCard({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("rounded-card bg-muted-surface px-6 py-5", className)}>{children}</section>;
}

function StatLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-body">
      <span className="shrink-0 whitespace-nowrap text-muted">{label}</span>
      <span className="min-w-0 truncate text-ink tabular-nums">{value}</span>
    </div>
  );
}

function timeSaved(min: number): { value: string; unit: string } {
  if (min >= 120) return { value: (min / 60).toFixed(1), unit: "hours" };
  return { value: formatNumber(min), unit: "min" };
}

const days = (n: number) => `${formatNumber(n)} ${n === 1 ? "day" : "days"}`;

export default function Insights() {
  const [data, setData] = useState<InsightsData | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loaded = useRef(false);
  const guard = useRef(createLatestGuard());
  const load = useCallback(() => {
    const isLatest = guard.current.next();
    Promise.all([ipc.insightsGet(), ipc.usageGet()])
      .then(([i, u]) => {
        if (!isLatest()) return;
        loaded.current = true;
        setData(i);
        setUsage(u);
        setError(null);
      })
      .catch((e) => {
        if (!isLatest()) return;
        if (loaded.current) toast.error(`Couldn't refresh insights: ${String(e)}`);
        else setError(String(e));
      });
  }, []);
  useEffect(load, [load]);
  useBackendEvent("history://changed", load);

  const header = <PageHeader title="Insights" />;

  if (error && !data) {
    return (
      <>
        {header}
        <EmptyState icon={<ChartColumn size={20} strokeWidth={1.5} />} title="Couldn't load insights" description={error} action={<Button onClick={load}>Try again</Button>} />
      </>
    );
  }
  if (!data || !usage) {
    return (
      <>
        {header}
        <SkeletonRows rows={4} />
      </>
    );
  }

  const usageCard = (
    <InsightCard>
      <h2 className="text-serif-heading text-ink">AI usage this month</h2>
      <p className="mt-1 text-body text-muted">Estimated from token counts at published rates.</p>
      <dl className="mt-4 grid grid-cols-2 gap-4 @md:grid-cols-3">
        {[
          ["Input tokens", formatNumber(usage.monthInputTokens)],
          ["Output tokens", formatNumber(usage.monthOutputTokens)],
          ["Estimated cost", formatUsd(usage.estCostUsd)],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-caption text-muted">{label}</dt>
            <dd className="mt-1 text-serif-figure text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </InsightCard>
  );

  if (data.totalWords === 0) {
    return (
      <>
        {header}
        <div className="flex flex-col gap-5 pb-10">
          <EmptyState icon={<ChartColumn size={20} strokeWidth={1.5} />} title="Nothing to show yet" description="Dictate something and your stats will appear here." />
          {usageCard}
        </div>
      </>
    );
  }


  const saved = timeSaved(data.timeSavedMin);
  const topApp = data.topApps[0];
  return (
    <div className="@container">
      {header}
      <div className="flex flex-col gap-5 pb-10">
        <div className="grid grid-cols-1 gap-5 @md:grid-cols-2 @3xl:grid-cols-3">
          <InsightCard>
            <div className="text-serif-figure text-ink">{formatNumber(data.avgWpm)}</div>
            <div className="mt-1 text-body text-muted">Words per minute</div>
            <div className="mt-4">
              <Gauge value={data.avgWpm} max={WPM_SCALE} label={`${formatNumber(data.avgWpm)} words per minute, on a scale to ${WPM_SCALE}`}>
                <span className="text-caption text-muted tabular-nums">of {WPM_SCALE} wpm</span>
              </Gauge>
            </div>
          </InsightCard>

          <InsightCard>
            <div className="text-serif-figure text-ink tabular-nums">
              {saved.value} <span className="font-sans text-body text-muted">{saved.unit}</span>
            </div>
            <div className="mt-1 text-body text-muted">Time saved by dictating</div>
            <div className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
              <StatLine label="Words this week" value={formatNumber(data.weekWords)} />
              <StatLine label="Current streak" value={data.currentStreak > 0 ? days(data.currentStreak) : "None yet"} />
            </div>
          </InsightCard>

          <InsightCard className="@md:col-span-2 @3xl:col-span-1">
            <div className="text-serif-figure text-ink">{formatNumber(data.totalWords)}</div>
            <div className="mt-1 text-body text-muted">Total words dictated</div>
            <div className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
              <StatLine label="Most used app" value={topApp ? topApp.name : "None yet"} />
              <StatLine label="Words there" value={topApp ? formatNumber(topApp.words) : "0"} />
            </div>
          </InsightCard>
        </div>

        <div className="grid grid-cols-1 gap-5 @3xl:grid-cols-2">
          <InsightCard>
            <h2 className="text-serif-heading text-ink">Where you write</h2>
            <p className="mb-5 mt-1 text-body text-muted">Share of your words by type of writing.</p>
            <BarList
              total={data.categories.reduce((n, c) => n + c.words, 0)}
              items={data.categories.map((c) => ({ label: CATEGORY_LABEL[c.category], value: c.words, icon: CATEGORY_ICON[c.category] }))}
              empty="No category data yet."
            />
          </InsightCard>

          <InsightCard>
            <h2 className="text-serif-heading text-ink">Top apps</h2>
            <p className="mb-5 mt-1 text-body text-muted">Share of all your words, per app.</p>
            <BarList total={data.totalWords} items={data.topApps.map((a) => ({ label: a.name, value: a.words }))} empty="No app data yet." />
          </InsightCard>
        </div>

        <InsightCard>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <h2 className="text-serif-heading text-ink tabular-nums">{data.currentStreak > 0 ? `${formatNumber(data.currentStreak)}-day streak` : "No streak yet"}</h2>
            <span className="text-caption text-muted tabular-nums">Longest {days(data.longestStreak)}</span>
          </div>
          <p className="mb-5 mt-1 text-body text-muted">When you dictate, by weekday and hour.</p>
          <Heatmap data={data.heatmap} />
        </InsightCard>

        {usageCard}
      </div>
    </div>
  );
}
