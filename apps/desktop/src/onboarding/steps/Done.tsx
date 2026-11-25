import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Button, Chord } from "../../components/ui";
import { ipc } from "../../lib/ipc";
import { toast, useSettings } from "../../lib/store";
import { clearModelId, clearStep, modelAction } from "../helpers";
import { StepFrame, type StepProps } from "../parts";

export function Done({ back, download }: StepProps) {
  const settings = useSettings((s) => s.settings);
  const load = useSettings((s) => s.load);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const name = settings?.userName?.trim();
  const modelId = download.modelId;

  // Is the chosen speech model still on its way?
  useEffect(() => {
    let alive = true;
    ipc
      .listModels()
      .then((m) => alive && setPending(modelAction(m, modelId).kind === "pending"))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [modelId, download.progress?.done]);

  const finish = async () => {
    setBusy(true);
    try {
      // The download may have finished while the shell was away: make sure a usable model is active.
      try {
        const a = modelAction(await ipc.listModels(), modelId);
        if (a.kind === "activate" && a.id) await ipc.setActiveModel(a.id);
      } catch (e) {
        toast.error(String(e));
      }
      await ipc.completeOnboarding();
      clearStep();
      clearModelId();
      await load();
    } catch (e) {
      toast.error(String(e));
      setBusy(false);
    }
  };

  return (
    <StepFrame
      eyebrow="All set"
      title={name ? `You're ready, ${name}.` : "You're ready."}
      subtitle="Utter now lives in your system tray, ready whenever you are."
      onSubmit={() => void finish()}
    >
      {pending && (
        <p className="mb-5 flex items-start gap-2 rounded-card bg-highlight-soft px-4 py-3 text-[13px] leading-relaxed text-ink" role="status">
          <Loader2 size={14} className="mt-0.5 shrink-0 animate-spin text-highlight" aria-hidden />
          Your speech model is still downloading. Utter will switch to it when it's done.
        </p>
      )}
      <ul className="flex flex-col gap-3.5">
        {[
          <>
            Hold <Chord chord={settings?.shortcuts.dictate?.[0]} className="mx-0.5 align-middle" /> in any app and speak.
          </>,
          <>
            Hold <Chord chord={settings?.shortcuts.dictateEnhance?.[0]} className="mx-0.5 align-middle" /> to dictate and have Claude polish it.
          </>,
          <>Utter keeps running from the tray icon near your clock. Closing this window won't quit it. Right-click the icon to open the hub or quit.</>,
        ].map((line, i) => (
          <li key={i} className="flex items-start gap-3 text-sm leading-relaxed text-ink">
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-success-soft text-success">
              <Check size={12} aria-hidden />
            </span>
            <span>{line}</span>
          </li>
        ))}
      </ul>
      <div className="mt-10 flex items-center gap-3">
        <Button variant="ghost" onClick={back}>
          Back
        </Button>
        <div className="flex-1" />
        <Button variant="primary" type="submit" className="h-10 px-5" loading={busy}>
          Open Utter
        </Button>
      </div>
    </StepFrame>
  );
}
