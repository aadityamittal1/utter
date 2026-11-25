import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Sidebar } from "./Sidebar";
import { useNav } from "../lib/store";
import type { Page } from "../lib/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Sidebar", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const current = () => [...host.querySelectorAll("[aria-current='page']")].map((e) => e.textContent?.trim());

  it.each<[Page, string]>([
    ["home", "Home"],
    ["history", "History"],
    ["settings", "Settings"],
  ])("marks only %s as current", (page, label) => {
    act(() => useNav.setState({ page }));
    act(() => root.render(<Sidebar />));
    expect(current()).toEqual([label]);
  });

  it("follows navigation clicks, with Settings inside the nav landmark", () => {
    act(() => useNav.setState({ page: "home" }));
    act(() => root.render(<Sidebar />));
    const settings = [...host.querySelectorAll("nav button")].find((b) => b.textContent?.trim() === "Settings") as HTMLButtonElement;
    expect(settings).toBeTruthy();
    act(() => settings.click());
    expect(current()).toEqual(["Settings"]);
  });
});
