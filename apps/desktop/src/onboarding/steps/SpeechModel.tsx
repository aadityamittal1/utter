import { useEffect, useState } from "react";
import { CheckCircle2, Download, Loader2 } from "lucide-react";
import { Button } from "../../components/ui";
import { ipc } from "../../lib/ipc";
import { cn } from "../../lib/cn";
import { formatBytes } from "../../lib/format";
import type { ModelStatus } from "../../lib/types";
import { pickModel } from "../helpers";
import { StepFooter, StepFrame, type StepProps } from "../parts";

export function SpeechModel({ next, back, download }: StepProps) {
  const [models, setModels] = useState<ModelStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(download.modelId);

  useEffect(() => {
    ipc
      .listModels()
      .then((m) => {
        setModels(m);
        setSelected((cur) => cur ?? pickModel(m)?.id ?? null);
      })
      .catch((e) => setError(String(e)));
  }, [download.progress?.done]);

  const current = models?.find((m) => m.id === selected);
  const started = download.modelId === selected;
  const p = started ? download.progress : null;
  const pct = p ? Math.round((p.downloaded / Math.max(1, p.total)) * 100) : 0;
  const ready = !!current && (current.downloaded || p?.done);
  const starting = started && !p && !download.error && !ready;
  const downloading = !!p && !p.done && !download.error;
  const busyDownload = starting || downloading;

  return (
    <StepFrame
      eyebrow="Step 4"
      title="Choose a speech model"
      subtitle="This is what turns your voice into text, entirely on your PC. We picked the best fit; the download keeps going while you finish setup."
      onSubmit={() => {
        // Make sure something is on its way before moving on.
        if (current && !started && (!current.downloaded || !current.active)) void download.start(current.id);
        next();
      }}
    >
      {error && (
        <p role="alert" className="mb-3 text-sm text-danger">
          {error}
        </p>
      )}
      <div role="radiogroup" aria-label="Speech model" className="flex flex-col gap-2">
        {(models ?? []).map((m) => {
          const on = m.id === selected;
          return (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setSelected(m.id)}
              disabled={busyDownload && download.modelId !== m.id}
              className={cn(
                "flex items-center gap-3 rounded-card border px-4 py-2.5 text-left transition-colors disabled:opacity-50",
                on ? "border-ember bg-ember-soft" : "border-line bg-surface hover:border-line-strong",
              )}
            >
              <span className={cn("flex size-4 shrink-0 items-center justify-center rounded-full border", on ? "border-ember" : "border-line-strong")}>
                {on && <span className="size-2 rounded-full bg-ember" />}
              </span>
              <span className="flex-1">
                <span className="text-sm font-medium text-ink">{m.label}</span>
                {m.recommended && <span className="ml-2 rounded-full bg-highlight-soft px-2 py-0.5 text-[11px] font-medium text-highlight">Recommended</span>}
                <span className="block text-xs text-muted">
                  {formatBytes(m.sizeBytes)} · {m.multilingual ? "Many languages" : "English"}
                </span>
              </span>
              {m.downloaded && <CheckCircle2 size={16} className="text-success" aria-label="Downloaded" />}
            </button>
          );
        })}
        {!models && !error && <div className="h-[60px] animate-pulse rounded-card bg-muted-surface" aria-busy="true" />}
      </div>

      <div className="mt-5 min-h-12">
        {starting && (
          <p className="flex items-center gap-2 text-sm text-muted" role="status">
            <Loader2 size={14} className="animate-spin" aria-hidden /> Starting…
          </p>
        )}
        {downloading && (
          <div aria-live="polite">
            <div className="h-1.5 overflow-hidden rounded-full bg-muted-surface" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Model download">
              <div className="h-full rounded-full bg-ember transition-[width] duration-200" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-2 text-xs text-muted">
              Downloading {pct}% of {formatBytes(p!.total)}. You can keep going.
            </p>
          </div>
        )}
        {download.error && started && (
          <p role="alert" className="text-sm text-danger">
            {download.error}{" "}
            <button type="button" className="font-medium underline" onClick={() => void download.start(selected!)}>
              Try again
            </button>
          </p>
        )}
        {ready && !busyDownload && (
          <p className="flex items-center gap-2 text-sm text-success" role="status">
            <CheckCircle2 size={15} aria-hidden /> Ready on this PC.
          </p>
        )}
        {current && !ready && !started && (
          <Button variant="secondary" icon={<Download size={15} aria-hidden />} onClick={() => void download.start(current.id)}>
            Download {formatBytes(current.sizeBytes)}
          </Button>
        )}
      </div>

      <StepFooter onBack={back} />
    </StepFrame>
  );
}
