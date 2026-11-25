import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/global.css";
import { AppShell } from "./components/AppShell";
import { applyCachedTheme } from "./lib/store";

applyCachedTheme(); // before first paint

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppShell />
  </StrictMode>,
);
