import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles/global.css";
import { on } from "./lib/ipc";
import type { PillState } from "./lib/types";

// Placeholder: the pill task replaces ./pill/Pill.tsx and ./pill/Bars.tsx.
function PillPlaceholder() {
  const [state, setState] = useState<PillState>({ state: "idle", mode: "dictate", elapsedMs: 0 });
  useEffect(() => {
    const off = on("pill://state", setState);
    return () => void off.then((f) => f());
  }, []);
  return (
    <div className="flex h-full items-center justify-center">
      <div className="rounded-full bg-[var(--ink)] px-4 py-1.5 text-xs text-[var(--paper)]">{state.message ?? state.state}</div>
    </div>
  );
}

// The pill window is transparent; only the capsule is painted.
document.body.style.background = "transparent";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PillPlaceholder />
  </StrictMode>,
);
