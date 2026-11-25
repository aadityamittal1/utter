import { useCallback, useEffect, useRef, useState } from "react";
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

function keyName(k: string): string {
  return NAMES[k] ?? (k.length === 1 ? k.toUpperCase() : k);
}

/**
 * Click to record a chord. Inside the app the backend captures keys globally
 * (so the Win key works); in a browser it falls back to window key events.
 */
export function ShortcutRecorder({ value, onChange, label }: { value: string[]; onChange: (chord: string[]) => void; label: string }) {
  const [recording, setRecording] = useState(false);
  const held = useRef<string[]>([]);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const stop = useCallback(() => {
    setRecording(false);
    held.current = [];
    if (isTauri()) void ipc.stopShortcutCapture();
  }, []);

  useEffect(() => {
    if (!recording) return;
    const cleanups: Array<() => void> = [];
    let cancelled = false;
    if (isTauri()) {
      void ipc.startShortcutCapture();
      void on("shortcut://captured", ({ chord }) => {
        onChangeRef.current(chord.split("+").filter(Boolean));
        stop();
      }).then((off) => (cancelled ? off() : cleanups.push(off)));
    } else {
      const down = (e: KeyboardEvent) => {
        e.preventDefault();
        if (e.key === "Escape") return stop();
        const name = keyName(e.key);
        if (!held.current.includes(name)) held.current = [...held.current, name];
        if (!MODS.includes(e.key)) {
          const mods = ["Ctrl", "Win", "Alt", "Shift"].filter((m) => held.current.includes(m));
          onChangeRef.current([...mods, name]);
          stop();
        }
      };
      const up = (e: KeyboardEvent) => {
        // modifier-only chords (e.g. Ctrl+Win) commit on release
        if (MODS.includes(e.key) && held.current.length > 0) {
          onChangeRef.current(held.current);
          stop();
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
  }, [recording, stop]);

  return (
    <button
      type="button"
      aria-label={`${label} shortcut. Press to change.`}
      onClick={() => (recording ? stop() : setRecording(true))}
      onBlur={() => recording && stop()}
      className={cn(
        "inline-flex h-9 min-w-[150px] items-center justify-between gap-3 rounded-control border bg-surface px-3 transition-colors",
        recording ? "border-ember" : "border-line hover:border-line-strong",
      )}
    >
      {recording ? <span className="text-[13px] text-accent">Press new keys...</span> : <Chord chord={value} />}
      <Keyboard size={15} aria-hidden className="text-faint" />
    </button>
  );
}
