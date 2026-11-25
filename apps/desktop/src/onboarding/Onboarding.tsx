import { useCallback, useEffect, useRef, useState } from "react";
import { Logo } from "../components/Logo";
import { ipc } from "../lib/ipc";
import { cn } from "../lib/cn";
import { formatBytes } from "../lib/format";
import { toast } from "../lib/store";
import { useBackendEvent } from "../lib/useBackendEvent";
import type { ModelProgress } from "../lib/types";
import { loadStep, saveStep, STEP_COUNT } from "./helpers";
import type { DownloadState, StepProps } from "./parts";
import { Welcome } from "./steps/Welcome";
import { ConnectClaude } from "./steps/ConnectClaude";
import { Microphone } from "./steps/Microphone";
import { SpeechModel } from "./steps/SpeechModel";
import { LearnShortcut } from "./steps/LearnShortcut";
import { TryIt } from "./steps/TryIt";
import { Personalize } from "./steps/Personalize";
import { Done } from "./steps/Done";

const STEPS: Array<{ label: string; Component: (p: StepProps) => React.ReactNode }> = [
  { label: "Welcome", Component: Welcome },
  { label: "Connect Claude", Component: ConnectClaude },
  { label: "Microphone", Component: Microphone },
  { label: "Speech model", Component: SpeechModel },
  { label: "Shortcut", Component: LearnShortcut },
  { label: "Try it", Component: TryIt },
  { label: "Personalize", Component: Personalize },
  { label: "Done", Component: Done },
];

export default function Onboarding() {
  const [step, setStep] = useState(loadStep);
  const [modelId, setModelId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ModelProgress | null>(null);
  const [dlError, setDlError] = useState<string | null>(null);
  const modelRef = useRef<string | null>(null);

  useEffect(() => saveStep(step), [step]);

  const go = useCallback((n: number) => setStep(Math.max(0, Math.min(STEP_COUNT - 1, n))), []);

  const finishDownload = useCallback(async (id: string) => {
    try {
      await ipc.setActiveModel(id);
    } catch (e) {
      setDlError(String(e));
    }
  }, []);

  useBackendEvent("model://progress", (p) => {
    if (p.id !== modelRef.current) return;
    setProgress(p);
    if (p.error) setDlError(p.error);
    else if (p.done) void finishDownload(p.id);
  });

  const download: DownloadState = {
    modelId,
    progress,
    error: dlError,
    start: async (id) => {
      modelRef.current = id;
      setModelId(id);
      setProgress(null);
      setDlError(null);
      try {
        const models = await ipc.listModels();
        if (models.find((m) => m.id === id)?.downloaded) {
          await finishDownload(id);
          setProgress({ id, downloaded: 1, total: 1, done: true });
          return;
        }
        await ipc.downloadModel(id);
      } catch (e) {
        setDlError(String(e));
        toast.error(String(e));
      }
    },
  };

  const { Component } = STEPS[step];
  const downloading = !!progress && !progress.done && !dlError && step > 3;

  return (
    <div className="relative flex h-full flex-col overflow-y-auto bg-bg">
      <header className="flex items-center justify-between px-10 pt-7">
        <Logo height={17} />
        <div className="flex items-center gap-4">
          {downloading && progress && (
            <span className="text-xs text-muted" aria-live="polite">
              Downloading model · {Math.round((progress.downloaded / Math.max(1, progress.total)) * 100)}% of {formatBytes(progress.total)}
            </span>
          )}
          <ol className="flex items-center gap-2" aria-label={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step].label}`}>
            {STEPS.map((s, i) => (
              <li key={s.label} aria-current={i === step ? "step" : undefined}>
                <button
                  type="button"
                  aria-label={s.label}
                  title={s.label}
                  disabled={i > step}
                  onClick={() => go(i)}
                  className={cn(
                    "block h-1.5 rounded-full transition-all duration-300 disabled:cursor-default",
                    i === step ? "w-6 bg-ember" : i < step ? "w-1.5 bg-ember/60 hover:bg-ember" : "w-1.5 bg-line-strong",
                  )}
                />
              </li>
            ))}
          </ol>
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center px-10 py-10">
        <div key={step} className="page-enter w-full max-w-[560px]">
          <Component next={() => go(step + 1)} back={() => go(step - 1)} download={download} />
        </div>
      </main>
    </div>
  );
}
