import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./styles/global.css";
import { Pill } from "./pill/Pill";
import { applyCachedAppearance } from "./lib/appearance";

// The pill window is transparent; only the capsule is painted. global.css keeps
// html[data-window="pill"] transparent even after HeroUI styles load.
document.documentElement.dataset.window = "pill";
applyCachedAppearance({ themeOnly: true });
document.documentElement.style.background = "transparent";
document.body.style.background = "transparent";

// Dev-only: pill.html?pill-harness shows every state side by side.
const Harness = import.meta.env.DEV
  ? lazy(() => import("./pill/Harness").then((m) => ({ default: m.Harness })))
  : null;
const harness = Harness !== null && new URLSearchParams(location.search).has("pill-harness");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {harness && Harness ? (
      <Suspense fallback={null}>
        <Harness />
      </Suspense>
    ) : (
      <Pill />
    )}
  </StrictMode>,
);
