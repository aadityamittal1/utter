import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";
import { Button, Select } from "../../components/ui";
import { ipc } from "../../lib/ipc";
import { useBackendEvent } from "../../lib/useBackendEvent";
import { Section, WithSettings } from "./parts";

const SEGMENTS = 24;

export default function Microphone() {
  const [devices, setDevices] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0);
  /** A start was issued and no stop has been issued since: the mic may be open. */
  const startedRef = useRef(false);
  const unmountedRef = useRef(false);

  useEffect(() => {
    ipc
      .listMicrophones()
      .then(setDevices)
      .catch((e) => setError(String(e)));
  }, []);

  useBackendEvent("mic://level", (l) => {
    if (startedRef.current) setLevel(Math.max(0, Math.min(1, l)));
  });

  /** Release the mic whenever a start was issued, even if it hasn't resolved yet. */
  const release = useCallback(() => {
    if (!startedRef.current) return;
    startedRef.current = false;
    void ipc.stopMicTest().catch(() => undefined);
  }, []);

  useEffect(() => {
    unmountedRef.current = false;
    const onVisibility = () => {
      if (document.visibilityState === "hidden" && startedRef.current) {
        release();
        setTesting(false);
        setLevel(0);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      unmountedRef.current = true;
      document.removeEventListener("visibilitychange", onVisibility);
      release();
    };
  }, [release]);

  const toggle = async () => {
    setError(null);
    if (testing) {
      setTesting(false);
      setLevel(0);
      release();
      return;
    }
    startedRef.current = true; // before the await: leaving mid-start must still stop
    setTesting(true);
    try {
      await ipc.startMicTest();
      if (unmountedRef.current || !startedRef.current) {
        // Left the tab (or stopped) while the start was in flight.
        startedRef.current = true;
        release();
      }
    } catch (e) {
      startedRef.current = false;
      if (!unmountedRef.current) {
        setTesting(false);
        setError(String(e));
      }
    }
  };

  return (
    <WithSettings>
      {(s, update) => (
        <div className="flex flex-col gap-4">
          <Section title="Input device" description="Choose which microphone Utter listens to.">
            <div className="py-4">
              {devices && devices.length === 0 ? (
                <p className="flex items-center gap-2 text-sm text-muted">
                  <MicOff size={16} aria-hidden /> No microphones found. Plug one in and reopen this tab.
                </p>
              ) : (
                <Select
                  label="Microphone"
                  value={s.microphone ?? ""}
                  disabled={!devices}
                  onChange={(e) => void update({ microphone: e.target.value || null })}
                  className="max-w-sm"
                >
                  <option value="">System default</option>
                  {s.microphone && devices && !devices.includes(s.microphone) && <option value={s.microphone}>{s.microphone} (not connected)</option>}
                  {(devices ?? []).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </Select>
              )}
            </div>
          </Section>

          <Section title="Test" description="Say something. The meter should move.">
            <div className="flex flex-col gap-3 py-4">
              <div className="flex items-center gap-4">
                <Button variant={testing ? "secondary" : "primary"} icon={<Mic size={15} />} onClick={() => void toggle()}>
                  {testing ? "Stop test" : "Test microphone"}
                </Button>
                <Meter level={testing ? level : 0} active={testing} />
              </div>
              {error && (
                <p role="alert" className="text-sm text-danger">
                  {error}
                </p>
              )}
            </div>
          </Section>

          <p className="max-w-[60ch] text-[13px] text-muted">
            Tip: Bluetooth headsets switch to a low-quality call mode when the mic opens, which can hurt accuracy and delay the first word. For best results use your laptop mic, a USB mic, or a wired headset.
          </p>
        </div>
      )}
    </WithSettings>
  );
}

function Meter({ level, active }: { level: number; active: boolean }) {
  const lit = Math.round(level * SEGMENTS);
  return (
    <div
      role="meter"
      aria-label="Microphone level"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(level * 100)}
      className="flex h-6 flex-1 items-center gap-[3px]"
    >
      {Array.from({ length: SEGMENTS }, (_, i) => (
        <span
          key={i}
          className={`h-full flex-1 rounded-[2px] transition-colors duration-75 ${i < lit ? (i > SEGMENTS * 0.8 ? "bg-danger" : "bg-ember") : active ? "bg-line-strong" : "bg-line"}`}
        />
      ))}
    </div>
  );
}
