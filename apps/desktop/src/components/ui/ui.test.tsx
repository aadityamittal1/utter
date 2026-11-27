import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Button } from "./Button";
import { Select } from "./Field";
import { Switch } from "./Switch";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ui wrappers", () => {
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

  it("Button maps onClick to HeroUI onPress and respects disabled", () => {
    const onClick = vi.fn();
    act(() => root.render(<Button onClick={onClick}>Save</Button>));
    act(() => host.querySelector("button")!.click());
    expect(onClick).toHaveBeenCalledTimes(1);

    onClick.mockClear();
    act(() => root.render(<Button onClick={onClick} disabled>Save</Button>));
    act(() => host.querySelector("button")!.click());
    expect(onClick).not.toHaveBeenCalled();
  });

  it("Switch reports the next boolean through onChange", () => {
    const onChange = vi.fn();
    act(() => root.render(<Switch checked={false} onChange={onChange} label="Sounds" />));
    const input = host.querySelector<HTMLInputElement>("[aria-label=Sounds]")!;
    expect(input, host.innerHTML).toBeTruthy();
    act(() => input.click());
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("Select shows the selected option and reports a native-shaped change event", async () => {
    const onChange = vi.fn();
    act(() =>
      root.render(
        <Select aria-label="Theme" value="light" onChange={onChange}>
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="">None</option>
        </Select>,
      ),
    );
    expect(host.textContent).toContain("Light");
    await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
    const options = [...document.querySelectorAll<HTMLElement>("[role=option]")];
    expect(options.map((o) => o.textContent)).toEqual(["System", "Light", "None"]);
    await act(async () => options[2].click());
    expect(onChange).toHaveBeenCalledWith({ target: { value: "" } });
  });
});
