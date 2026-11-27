import type { ReactNode } from "react";
import { Switch as HeroSwitch } from "@heroui/react";

export interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Accessible name. Render any visible text beside the switch yourself. */
  label: string;
  disabled?: boolean;
  id?: string;
}

/** On = ink (HeroUI accent), off = raised fill. */
export function Switch({ checked, onChange, label, disabled, id }: SwitchProps) {
  return (
    <HeroSwitch id={id} isSelected={checked} onChange={onChange} isDisabled={disabled} aria-label={label}>
      <HeroSwitch.Content>
        <HeroSwitch.Control>
          <HeroSwitch.Thumb />
        </HeroSwitch.Control>
      </HeroSwitch.Content>
    </HeroSwitch>
  );
}

/** Row with title + description on the left and a control on the right. */
export function SettingRow({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-3.5">
      <div className="min-w-0">
        <div className="text-body-strong text-ink">{title}</div>
        {description && <div className="mt-0.5 max-w-[52ch] text-caption text-muted">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
