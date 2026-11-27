import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import SettingsDialog from "./SettingsDialog";
import { useNav, useSettings, type SettingsSection } from "../../lib/store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 30))));
const text = () => document.body.textContent ?? "";
const labelled = (label: string) => document.body.querySelector(`[aria-label="${label}"]`);

/** Every control that existed on the old tabbed Settings page, by section. */
const EXPECT: Record<SettingsSection, { title: string; labels: string[]; copy: string[] }> = {
  general: {
    title: "General",
    labels: ["Spoken language", "Translate to English", "Theme", "Accent color", "Your name", "Microphone"],
    copy: ["Shortcuts", "Test microphone"],
  },
  system: {
    title: "System",
    labels: ["Launch app at login", "Show the pill at all times", "Dictation sounds", "Keep microphone warm"],
    copy: [],
  },
  ai: { title: "AI", labels: ["Claude model"], copy: ["Claude API key", "Save and test", "Usage this month"] },
  speech: { title: "Speech model", labels: [], copy: ["Models on this PC"] },
  privacy: {
    title: "Privacy & data",
    labels: ["History retention", "Keep audio", "Context awareness"],
    copy: ["Delete all history", "Category rules", "Add rule"],
  },
  about: { title: "About", labels: [], copy: ["Check for updates", "License"] },
};

describe("SettingsDialog", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => useSettings.getState().load());
    act(() => root.render(<SettingsDialog />));
  });
  afterEach(() => {
    act(() => useNav.getState().closeSettings());
    act(() => root.unmount());
    host.remove();
  });

  it("renders nothing until opened", () => {
    expect(document.body.querySelector("[role=dialog]")).toBeNull();
  });

  it.each(Object.keys(EXPECT) as SettingsSection[])("opens at %s with every control of that section", async (section) => {
    act(() => useNav.getState().openSettings(section));
    await flush();
    const e = EXPECT[section];
    expect(document.body.querySelector("[role=dialog]")).not.toBeNull();
    expect(document.body.querySelector("h1")?.textContent).toBe(e.title);
    for (const l of e.labels) expect(labelled(l), `label ${l}`).not.toBeNull();
    for (const c of e.copy) expect(text(), `copy ${c}`).toContain(c);
  });

  it("switches section from its own nav", async () => {
    act(() => useNav.getState().openSettings());
    await flush();
    const nav = document.body.querySelector("nav[aria-label='Settings sections']")!;
    const system = [...nav.querySelectorAll("button")].find((b) => b.textContent?.includes("System"))!;
    act(() => system.click());
    await flush();
    expect(document.body.querySelector("h1")?.textContent).toBe("System");
    expect(useNav.getState().settingsSection).toBe("system");
  });
});
