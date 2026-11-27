import type { ReactNode } from "react";
import { Button as HeroButton } from "@heroui/react";
import { Tooltip } from "../../../components/ui";

/** 32px ghost icon button with a tooltip, meant to sit inside a `<Dropdown>` as its trigger. */
export function MenuIconButton({ label, children, disabled }: { label: string; children: ReactNode; disabled?: boolean }) {
  return (
    <Tooltip delay={300}>
      <HeroButton isIconOnly variant="ghost" aria-label={label} isDisabled={disabled} className="size-8 min-w-8 rounded-control text-muted md:size-8">
        {children}
      </HeroButton>
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip>
  );
}
