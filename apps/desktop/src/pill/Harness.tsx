// Dev-only harness (pill.html?pill-harness): shows every pill state, including the
// ones the mock demo never reaches (19-minute warning, long error, menu).
// Not shipped: pill.tsx only imports it when import.meta.env.DEV is true.
import { useEffect, useState } from "react";
import type { PillState } from "../lib/types";
import { PillView, usePrefersReducedMotion } from "./Pill";
import { BAR_COUNT } from "./pillLogic";
import "./pill.css";

const base = { mode: "dictate" };
const CASES: { label: string; state: PillState; menu?: boolean; live?: boolean }[] = [
  { label: "idle", state: { ...base, state: "idle", elapsedMs: 0 } },
  { label: "listening 0:04", state: { ...base, state: "listening", elapsedMs: 4_000 }, live: true },
  { label: "listening 0:12", state: { ...base, state: "listening", elapsedMs: 12_000 }, live: true },
  { label: "locked 1:07", state: { ...base, state: "locked", mode: "handsFree", elapsedMs: 67_000 }, live: true },
  { label: "warning 19:18", state: { ...base, state: "listening", elapsedMs: 19 * 60_000 + 18_000 }, live: true },
  { label: "locked warning", state: { ...base, state: "locked", mode: "handsFree", elapsedMs: 19 * 60_000 + 18_000 }, live: true },
  { label: "thinking", state: { ...base, state: "thinking", elapsedMs: 0 } },
  { label: "done", state: { ...base, state: "done", elapsedMs: 0, message: "Inserted" } },
  { label: "done (words)", state: { ...base, state: "done", elapsedMs: 0, message: "Inserted 24 words" } },
  { label: "error", state: { ...base, state: "error", elapsedMs: 0, message: "Didn't catch that" } },
  { label: "error (long)", state: { ...base, state: "error", elapsedMs: 0, message: "Add an API key to use commands" } },
  { label: "menu", state: { ...base, state: "idle", elapsedMs: 0 }, menu: true },
];

function useFakeLevels(on: boolean): number[] {
  const [levels, setLevels] = useState<number[]>(() => new Array(BAR_COUNT).fill(0));
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => {
      const t = Date.now() / 220;
      setLevels(Array.from({ length: BAR_COUNT }, (_, i) => Math.max(0.05, Math.min(1, 0.45 + Math.sin(t + i * 0.7) * 0.3 + Math.sin(t * 2.3 + i) * 0.15))));
    }, 60);
    return () => clearInterval(id);
  }, [on]);
  return levels;
}

export function Harness() {
  const levels = useFakeLevels(true);
  const reduced = usePrefersReducedMotion();
  const [dark, setDark] = useState(true);
  return (
    <div style={{ position: "fixed", inset: 0, overflow: "auto", background: dark ? "#2a2a33" : "#ececf0", padding: 16, fontFamily: "var(--font-sans)", color: dark ? "#fff" : "#111" }}>
      <button onClick={() => setDark((d) => !d)} style={{ marginBottom: 12 }}>
        backdrop: {dark ? "dark" : "light"} (window is 360x72, outlined)
      </button>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, 360px)", gap: 14 }}>
        {CASES.map((c) => (
          <div key={c.label}>
            <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 4 }}>{c.label}</div>
            <div style={{ position: "relative", width: 360, height: 72, outline: "1px dashed rgb(128 128 128 / 0.5)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <PillView state={c.state} levels={c.live ? levels : []} menuOpen={c.menu} reduced={reduced} onAction={(a) => console.log("pill action", a)} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
