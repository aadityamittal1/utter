import { useEffect, useRef, useState } from "react";
import { Keyboard } from "lucide-react";
import { ipc, isTauri, on } from "../../lib/ipc";
import { cn } from "../../lib/cn";
import { Chord } from "./Kbd";

const MODS = ["Control", "Alt", "Shift", "Meta"];
const NAMES: Record<string, string> = {
  Control: "Ctrl",
  Meta: "Win",
  " ": "Space",
  Escape: "Esc",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
};
const MOD_ORDER = ["Ctrl", "Win", "Alt", "Shift"];

function keyName(k: string): string {
  return NAMES[k] ?? (k.length === 1 ? k.toUpperCase() : k);
}

/**
 * Click to record one binding. `value` / `onChange` use a full chord string
 * such as "Ctrl+Win+Space". Inside the app the backend captures keys globally
 * (so the Win key works); in a browser it falls back to window key events.
 */
export function ShortcutRecorder({ value, onChange, label }: { value: string | undefined; onChange: (chord: string) => void; label: string }) {
  const [recording, setRecording] = useState(false);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    if (!recording) return;
    let cancelled = false;
    const cleanups: Array<() => void> = [];

    if (isTauri()) {
      // Listener first, so an immediate capture event is never missed.
      void (async () => {
        try {
          const off = await on("shortcut://captured", ({ chord }) => {
            onChangeRef.current(chord);
            setRecording(false);
          });
          if (cancelled) return off();
          cleanups.push(off);
          await ipc.startShortcutCapture();
        } catch {
          setRecording(false);
        }
      })();
      // Always release the global capture, however recording ends (including unmount).
      cleanups.push(() => void ipc.stopShortcutCapture().catch(() => undefined));
    } else {
      let held: string[] = [];
      const down = (e: KeyboardEvent) => {
        e.preventDefault();
        if (e.key === "Escape") return setRecording(false);
        const name = keyName(e.key);
        if (!held.includes(name)) held = [...held, name];
        if (!MODS.includes(e.key)) {
          const mods = MOD_ORDER.filter((m) => held.includes(m));
          onChangeRef.current([...mods, name].join("+"));
          setRecording(false);
        }
      };
      const up = (e: KeyboardEvent) => {
        // modifier-only chords (e.g. Ctrl+Win) commit on release
        if (MODS.includes(e.key) && held.length > 0) {
          onChangeRef.current(MOD_ORDER.filter((m) => held.includes(m)).join("+"));
          setRecording(false);
        }
      };
      window.addEventListener("keydown", down);
      window.addEventListener("keyup", up);
      cleanups.push(
        () => window.removeEventListener("keydown", down),
        () => window.removeEventListener("keyup", up),
      );
    }
    return () => {
      cancelled = true;
      cleanups.forEach((c) => c());
    };
  }, [recording]);

  return (
    <button
      type="button"
      aria-label={`${label} shortcut. Press to change.`}
      onClick={() => setRecording((r) => !r)}
      onBlur={() => setRecording(false)}
      className={cn(
        "inline-flex h-9 min-w-[150px] items-center justify-between gap-3 rounded-control border bg-surface px-3 transition-colors",
        recording ? "border-ember" : "border-line hover:border-line-strong",
      )}
    >
      {recording ? <span className="text-[13px] text-ink">Press new keys...</span> : <Chord chord={value} />}
      <Keyboard size={15} aria-hidden className="text-faint" />
    </button>
  );
}
