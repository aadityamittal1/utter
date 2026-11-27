import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/global.css";
import { AppShell } from "./components/AppShell";
import { applyCachedTheme } from "./lib/store";
import { startSystemAppearance } from "./lib/systemAppearance";

applyCachedTheme(); // before first paint
startSystemAppearance();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppShell />
  </StrictMode>,
);
