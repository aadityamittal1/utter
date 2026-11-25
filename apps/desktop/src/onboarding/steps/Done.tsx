import { useState } from "react";
import { Check } from "lucide-react";
import { Button, Chord } from "../../components/ui";
import { ipc } from "../../lib/ipc";
import { toast, useSettings } from "../../lib/store";
import { clearStep } from "../helpers";
import { StepFrame, type StepProps } from "../parts";

export function Done({ back }: StepProps) {
  const settings = useSettings((s) => s.settings);
  const load = useSettings((s) => s.load);
  const [busy, setBusy] = useState(false);
  const name = settings?.userName?.trim();

  const finish = async () => {
    setBusy(true);
    try {
      await ipc.completeOnboarding();
      clearStep();
      await load();
    } catch (e) {
      toast.error(String(e));
      setBusy(false);
    }
  };

  return (
    <StepFrame eyebrow="All set" title={name ? `You're ready, ${name}.` : "You're ready."} subtitle="Utter now lives in your system tray, ready whenever you are.">
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
        <Button variant="primary" className="h-10 px-5" loading={busy} onClick={() => void finish()} autoFocus>
          Open Utter
        </Button>
      </div>
    </StepFrame>
  );
}
