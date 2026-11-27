import { useEffect, useState } from "react";
import { MicOff } from "lucide-react";
import { Select } from "../../components/ui";
import { ipc } from "../../lib/ipc";
import { useSettings } from "../../lib/store";
import { useBackendEvent } from "../../lib/useBackendEvent";
import { StepFooter, StepFrame, type StepProps } from "../parts";

const SEGMENTS = 24;

/** Mic start/stop calls run strictly in order, so a stop can never overtake its start. */
let micChain: Promise<unknown> = Promise.resolve();
function runMic(fn: () => Promise<void>): Promise<void> {
  const p = micChain.then(fn);
  micChain = p.catch(() => undefined);
  return p;
}

export function Microphone({ next, back }: StepProps) {
  const mic = useSettings((s) => s.settings?.microphone ?? null);
  const update = useSettings((s) => s.update);
  const [devices, setDevices] = useState<string[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState(false);

  useEffect(() => {
    let alive = true;
    ipc
      .listMicrophones()
      .then((d) => alive && setDevices(d))
      .catch((e) => alive && (setDevices([]), setListError(String(e))));
    return () => {
      alive = false;
    };
  }, []);

  // (Re)start the level test whenever the chosen device changes. Stop only after start settles,
  // so a quick unmount can never leave the mic open.
  useEffect(() => {
    let alive = true;
    const started = runMic(() => ipc.startMicTest());
    started.then(
      () => alive && setTestError(null),
      (e) => alive && setTestError(String(e)),
    );
    return () => {
      alive = false;
      runMic(() => ipc.stopMicTest()).catch(() => undefined);
    };
  }, [mic]);

  useBackendEvent("mic://level", (l) => {
    setLevel(l);
    if (l > 0.12) setHeard(true);
  });

  const lit = Math.round(Math.min(1, level * 1.4) * SEGMENTS);
  const none = devices !== null && devices.length === 0;

  return (
    <StepFrame eyebrow="Step 3" title="Pick your microphone" subtitle="Say something. The meter should move. Utter only listens while you hold the shortcut." onSubmit={next}>
      {none ? (
        <div className="rounded-card border border-line bg-surface p-5" role="alert">
          <div className="flex items-start gap-3">
            <MicOff size={16} strokeWidth={1.5} className="mt-0.5 text-danger" aria-hidden />
            <div>
              <p className="text-body-strong text-ink">No microphone found</p>
              <p className="mt-1 text-body text-muted">
                {listError ?? "Plug one in, or check Windows: Settings → Privacy & security → Microphone, and turn on “Let desktop apps access your microphone”."}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <Select label="Microphone" value={mic ?? ""} disabled={devices === null} onChange={(e) => void update({ microphone: e.target.value || null })}>
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
                  className="h-4 flex-1 rounded-sm transition-colors duration-[83ms] ease-fluent"
                  style={{ background: i < lit ? (i > SEGMENTS * 0.8 ? "var(--ember)" : "var(--success)") : "var(--border)" }}
                />
              ))}
            </div>
            {testError ? (
              <p role="alert" className="mt-2 text-caption text-danger">
                Couldn't listen to this microphone: {testError}
              </p>
            ) : (
              <p className="mt-2 text-caption text-muted" aria-live="polite">
                {heard ? "Sounds good, we can hear you." : "Waiting for sound… try saying “testing one two three”."}
              </p>
            )}
          </div>
        </div>
      )}
      <StepFooter onBack={back} />
    </StepFrame>
  );
}
