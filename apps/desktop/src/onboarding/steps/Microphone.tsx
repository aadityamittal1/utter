import { useEffect, useRef, useState } from "react";
import { MicOff } from "lucide-react";
import { Select } from "../../components/ui";
import { ipc } from "../../lib/ipc";
import { useSettings } from "../../lib/store";
import { useBackendEvent } from "../../lib/useBackendEvent";
import { StepFooter, StepFrame, type StepProps } from "../parts";

const SEGMENTS = 24;

export function Microphone({ next, back }: StepProps) {
  const mic = useSettings((s) => s.settings?.microphone ?? null);
  const update = useSettings((s) => s.update);
  const [devices, setDevices] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const peak = useRef(0);
  const [heard, setHeard] = useState(false);

  useEffect(() => {
    let alive = true;
    ipc
      .listMicrophones()
      .then((d) => alive && setDevices(d))
      .catch((e) => alive && (setDevices([]), setError(String(e))));
    ipc.startMicTest().catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
      void ipc.stopMicTest().catch(() => undefined);
    };
  }, []);

  useBackendEvent("mic://level", (l) => {
    setLevel(l);
    peak.current = Math.max(peak.current, l);
    if (l > 0.12) setHeard(true);
  });

  const lit = Math.round(Math.min(1, level * 1.4) * SEGMENTS);
  const none = devices !== null && devices.length === 0;

  return (
    <StepFrame eyebrow="Step 3" title="Pick your microphone" subtitle="Say something. The meter should move. Utter only listens while you hold the shortcut.">
      {none ? (
        <div className="rounded-card border border-line bg-surface p-5" role="alert">
          <div className="flex items-start gap-3">
            <MicOff size={18} className="mt-0.5 text-danger" aria-hidden />
            <div>
              <p className="text-sm font-semibold text-ink">No microphone found</p>
              <p className="mt-1 text-[13px] leading-relaxed text-muted">
                {error ?? "Plug one in, or check Windows: Settings → Privacy & security → Microphone, and turn on “Let desktop apps access your microphone”."}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <Select
            label="Microphone"
            value={mic ?? ""}
            disabled={devices === null}
            onChange={(e) => void update({ microphone: e.target.value || null })}
          >
            <option value="">System default</option>
            {(devices ?? []).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>

          <div>
            <div className="flex h-10 items-center gap-[3px] rounded-control border border-line bg-surface px-3" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={1} aria-valuenow={Number(level.toFixed(2))}>
              {Array.from({ length: SEGMENTS }, (_, i) => (
                <span
                  key={i}
                  className="h-4 flex-1 rounded-[2px] transition-colors duration-75"
                  style={{ background: i < lit ? (i > SEGMENTS * 0.8 ? "var(--accent)" : "var(--success)") : "var(--border)" }}
                />
              ))}
            </div>
            <p className="mt-2 text-xs text-muted" aria-live="polite">
              {heard ? "Sounds good, we can hear you." : "Waiting for sound… try saying “testing one two three”."}
            </p>
          </div>
        </div>
      )}
      <StepFooter onBack={back} onNext={next} />
    </StepFrame>
  );
}
