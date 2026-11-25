import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button, Chord, Textarea } from "../../components/ui";
import { ipc, isTauri } from "../../lib/ipc";
import { useSettings } from "../../lib/store";
import { useBackendEvent } from "../../lib/useBackendEvent";
import type { HistoryItem } from "../../lib/types";
import { StepFooter, StepFrame, type StepProps } from "../parts";

const SAMPLE: Pick<HistoryItem, "rawText" | "finalText"> = {
  rawText: "um hey sarah so i wanted to uh follow up on the proposal can we talk thursday morning",
  finalText: "Hey Sarah, I wanted to follow up on the proposal. Can we talk Thursday morning?",
};

export function TryIt({ next, back }: StepProps) {
  const dictate = useSettings((s) => s.settings?.shortcuts.dictate?.[0]);
  const enhance = useSettings((s) => s.settings?.shortcuts.dictateEnhance?.[0]);
  const noHistory = useSettings((s) => s.settings?.historyRetention === "never");
  const [baseline, setBaseline] = useState<string | null | undefined>(undefined); // undefined = not loaded yet
  const [latest, setLatest] = useState<Pick<HistoryItem, "rawText" | "finalText"> | null>(null);
  const baselineRef = useRef<string | null | undefined>(undefined);
  const focused = useRef<HTMLTextAreaElement | null>(null);
  const [email, setEmail] = useState("");
  const [prompt, setPrompt] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [item] = await ipc.historyList(undefined, 1, 0);
      if (item && item.id !== baselineRef.current) setLatest({ rawText: item.rawText, finalText: item.finalText });
    } catch {
      /* the comparison is a nice-to-have; dictation itself still works */
    }
  }, []);

  useEffect(() => {
    let alive = true;
    ipc
      .historyList(undefined, 1, 0)
      .then(([item]) => {
        if (!alive) return;
        baselineRef.current = item?.id ?? null;
        setBaseline(item?.id ?? null);
      })
      .catch(() => alive && setBaseline(null));
    return () => {
      alive = false;
    };
  }, []);
  useBackendEvent("history://changed", () => void refresh());

  const simulate = () => {
    setLatest(SAMPLE);
    const el = focused.current;
    if (el === null) return;
    const set = el.id === "try-email" ? setEmail : setPrompt;
    set((v) => (v ? `${v} ` : "") + SAMPLE.finalText);
  };

  return (
    <StepFrame
      onSubmit={next}
      eyebrow="Step 6"
      title="Try it for real"
      subtitle="Click a box below, hold your shortcut, and say a sentence the way you'd naturally say it. Ums and all."
    >
      <div className="flex flex-col gap-4">
        <Textarea
          id="try-email"
          label="Practice: an email"
          rows={2}
          placeholder="“Hey Sarah, quick follow-up on the proposal…”"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onFocus={(e) => (focused.current = e.target)}
        />
        <Textarea
          id="try-prompt"
          label="Practice: a prompt for an AI"
          rows={2}
          placeholder="“Summarize this article in three bullet points…”"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onFocus={(e) => (focused.current = e.target)}
        />
      </div>

      <div className="mt-5 rounded-card border border-line bg-surface" aria-live="polite">
        {latest ? (
          <div className="grid divide-y divide-line sm:grid-cols-2 sm:divide-x sm:divide-y-0">
            <div className="p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-faint">Before</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{latest.rawText}</p>
            </div>
            <div className="p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">After</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink">{latest.finalText}</p>
            </div>
          </div>
        ) : (
          <p className="px-4 py-3.5 text-[13px] text-muted">
            {baseline === undefined
              ? "Loading…"
              : noHistory
                ? "Your history is set to never save, so there's no before and after to show. Dictation still works; you can change this in Settings → Privacy."
                : "Your before and after will show up here."}
          </p>
        )}
      </div>

      <div className="mt-4 flex items-start gap-3 rounded-card bg-highlight-soft px-4 py-3.5">
        <Sparkles size={16} className="mt-0.5 shrink-0 text-highlight" aria-hidden />
        <div className="text-[13px] leading-relaxed text-ink">
          <p className="font-medium">Want it polished further?</p>
          <p className="mt-0.5 text-muted">
            Hold <Chord chord={enhance} className="mx-0.5 align-middle" /> instead of <Chord chord={dictate} className="mx-0.5 align-middle" /> to dictate and enhance: Claude tightens the wording and structures it for where you are.
          </p>
        </div>
      </div>

      {!isTauri() && (
        <Button variant="ghost" size="sm" className="mt-3" onClick={simulate} icon={<ArrowRight size={13} aria-hidden />}>
          Simulate a dictation (preview only)
        </Button>
      )}
      <StepFooter onBack={back} />
    </StepFrame>
  );
}
