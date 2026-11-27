import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Mount a node into document.body; returns an unmount function. */
export function mount(node: ReactNode): { root: Root; unmount: () => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return {
    root,
    unmount: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

/** Set a controlled input/textarea value the way a user edit would. */
export function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  act(() => {
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

export const dialog = (): HTMLElement | null => document.querySelector('[role="dialog"]');

export const buttonByText = (text: string): HTMLButtonElement | undefined => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);

/** Let promises and timers settle inside act. */
export async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}
