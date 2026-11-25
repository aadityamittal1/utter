import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "../lib/store";
import { createLatestGuard } from "./parts/history/latest";
import { ChartColumn } from "lucide-react";
import { ipc } from "../lib/ipc";
import { formatNumber, formatUsd } from "../lib/format";
import { useBackendEvent } from "../lib/useBackendEvent";
import type { Insights as InsightsData, Usage } from "../lib/types";
import { Button, CardSection, EmptyState, PageHeader, SkeletonRows } from "../components/ui";
import { Heatmap } from "./parts/insights/Heatmap";
import { BarList } from "./parts/insights/BarList";
import { CATEGORY_LABEL } from "./parts/history/shared";

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[12px] text-muted">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="font-display text-[40px] leading-none tabular-nums text-ink">{value}</span>
        {unit && <span className="text-[13px] text-muted">{unit}</span>}
      </div>
    </div>
  );
}

function timeSaved(min: number): { value: string; unit: string } {
  if (min >= 120) return { value: (min / 60).toFixed(1), unit: "hours" };
  return { value: formatNumber(min), unit: "min" };
}

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

  const header = <PageHeader title="Insights" description="How much you talk, and where." />;

  if (error && !data) {
    return (
      <>
        {header}
        <EmptyState icon={<ChartColumn size={18} />} title="Couldn't load insights" description={error} action={<Button onClick={load}>Try again</Button>} />
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
    <CardSection title="AI usage this month" description="Estimated from token counts at published rates.">
      <div className="flex flex-wrap gap-x-10 gap-y-3">
        <Stat label="Input tokens" value={formatNumber(usage.monthInputTokens)} />
        <Stat label="Output tokens" value={formatNumber(usage.monthOutputTokens)} />
        <Stat label="Estimated cost" value={formatUsd(usage.estCostUsd)} />
      </div>
    </CardSection>
  );

  if (data.totalWords === 0) {
    return (
      <>
        {header}
        <div className="flex flex-col gap-5 pb-10">
          <EmptyState icon={<ChartColumn size={18} />} title="Nothing to show yet" description="Dictate something and your stats will appear here." />
          {usageCard}
        </div>
      </>
    );
  }

  const saved = timeSaved(data.timeSavedMin);
  return (
    <>
      {header}
      <div className="flex flex-col gap-5 pb-10">
        <div className="grid grid-cols-2 gap-x-8 gap-y-6 rounded-card border border-line bg-surface px-6 py-5 md:grid-cols-5">
          <Stat label="Total words" value={formatNumber(data.totalWords)} />
          <Stat label="Average speed" value={formatNumber(data.avgWpm)} unit="wpm" />
          <Stat label="Time saved" value={saved.value} unit={saved.unit} />
          <Stat label="Current streak" value={formatNumber(data.currentStreak)} unit={data.currentStreak === 1 ? "day" : "days"} />
          <Stat label="Longest streak" value={formatNumber(data.longestStreak)} unit={data.longestStreak === 1 ? "day" : "days"} />
        </div>

        <CardSection title="When you dictate" description="Words by weekday and hour.">
          <Heatmap data={data.heatmap} />
        </CardSection>

        <div className="grid gap-5 md:grid-cols-2">
          <CardSection title="Top apps" description="Words dictated per app.">
            <BarList items={data.topApps.map((a) => ({ label: a.name, value: a.words }))} empty="No app data yet." />
          </CardSection>
          <CardSection title="Where it goes" description="Words by type of writing.">
            <BarList items={data.categories.map((c) => ({ label: CATEGORY_LABEL[c.category], value: c.words }))} empty="No category data yet." />
          </CardSection>
        </div>

        {usageCard}
      </div>
    </>
  );
}
