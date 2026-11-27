import { useEffect, useState } from "react";
import { Kbd } from "../../components/ui";
import { isTauri } from "../../lib/ipc";
import { cn } from "../../lib/cn";
import { formatChord } from "../../lib/format";
import { useSettings } from "../../lib/store";
import { useBackendEvent } from "../../lib/useBackendEvent";
import { StepFooter, StepFrame, type StepProps } from "../parts";

/** Browser KeyboardEvent.key -> chord key name, for the in-page simulation. */
const DOM_KEYS: Record<string, string> = { Control: "Ctrl", Meta: "Win", Shift: "Shift", Alt: "Alt", " ": "Space" };

export function LearnShortcut({ next, back }: StepProps) {
  const chord = useSettings((s) => s.settings?.shortcuts.dictate?.[0]);
  const handsFree = useSettings((s) => s.settings?.shortcuts.handsFree?.[0]);
  const keys = formatChord(chord);
  const [listening, setListening] = useState(false);
  const [held, setHeld] = useState<Set<string>>(new Set());
  const [pressedOnce, setPressedOnce] = useState(false);

  useBackendEvent("pill://state", (p) => {
    const on = p.state === "listening" || p.state === "locked";
    setListening(on);
    if (on) setPressedOnce(true);
  });

  // Dev convenience: simulate by pressing the keys in the page (browser mock only).
  useEffect(() => {
    if (isTauri()) return;
    const down = (e: KeyboardEvent) => {
      const k = DOM_KEYS[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key);
      setHeld((h) => new Set(h).add(k));
    };
    const up = (e: KeyboardEvent) => {
      const k = DOM_KEYS[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key);
      setHeld((h) => {
        const n = new Set(h);
        n.delete(k);
        return n;
      });
    };
    const blur = () => setHeld(new Set());
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  const simulated = keys.length > 0 && keys.every((k) => held.has(k));
  const active = listening || simulated;
  if (active && !pressedOnce) setPressedOnce(true);

  return (
    <StepFrame
      onSubmit={next}
      eyebrow="Step 5"
      title="Hold to talk"
      subtitle={
        <>
          Hold {keys.length ? keys.join(" + ") : "your dictate shortcut"}, speak, and let go. Your words appear wherever your cursor is.
        </>
      }
    >
      <div
        className={cn(
          "flex flex-col items-center gap-5 rounded-panel border px-6 py-10 transition-colors duration-[167ms] ease-fluent",
          active ? "border-ember bg-ember-soft" : "border-line bg-surface",
        )}
      >
        <div className="flex items-center gap-3" aria-label={keys.join(" plus ")}>
          {keys.length === 0 && <span className="text-body text-faint">No dictate shortcut set</span>}
          {keys.map((k, i) => (
            <span key={`${k}-${i}`} className="flex items-center gap-3">
              {i > 0 && <span className="text-faint" aria-hidden>+</span>}
              <kbd
                className={cn(
                  "inline-flex h-12 min-w-14 items-center justify-center rounded-control border border-b-[3px] px-4 font-mono text-body-lg font-medium transition-[background-color,border-color,color] duration-[167ms] ease-fluent",
                  active
                    ? "-translate-y-0.5 border-ember bg-ember text-on-accent shadow-[0_6px_18px_-6px_var(--accent-fill)]"
                    : "border-line-strong bg-surface text-ink",
                )}
              >
                {k}
              </kbd>
            </span>
          ))}
        </div>
        <p className="text-body text-muted" aria-live="polite">
          {active ? "Listening… let go when you're done." : pressedOnce ? "That's it. Easy, right?" : "Try it now. Press and hold."}
        </p>
      </div>
      <ul className="mt-5 space-y-1.5 text-body text-muted">
        <li>
          Prefer hands-free? {handsFree ? <><Kbd>{formatChord(handsFree).join("+")}</Kbd> or </> : null}double-tap the shortcut to keep listening, press again to stop.
        </li>
        <li>
          Press <Kbd>Esc</Kbd> while recording to cancel. You can change every shortcut in Settings.
        </li>
      </ul>
      {!isTauri() && <p className="mt-3 text-caption text-faint">Preview: press the keys on your keyboard to simulate.</p>}
      <StepFooter onBack={back} />
    </StepFrame>
  );
}
