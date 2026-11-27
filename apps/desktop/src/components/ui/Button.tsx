import type { ReactNode, Ref } from "react";
import { Button as HeroButton, Spinner, Tooltip, type ButtonProps as HeroButtonProps } from "@heroui/react";
import { cn } from "../../lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANT: Record<Variant, HeroButtonProps["variant"]> = {
  primary: "primary",
  secondary: "secondary",
  ghost: "ghost",
  danger: "danger-soft",
};
// HeroUI shrinks buttons on md+ screens; the desktop app is always "md+", so pin the sizes.
const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 md:h-8 gap-1.5",
  md: "h-10 px-4 md:h-10 gap-2",
};

type Base = Omit<HeroButtonProps, "variant" | "size" | "isPending" | "isDisabled" | "onPress" | "children" | "ref" | "className">;

export interface ButtonProps extends Base {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  loading?: boolean;
  disabled?: boolean;
  /** Hover/focus tooltip. Not for disabled reasons: put those in helper text, since disabled buttons are not focusable. */
  title?: string;
  /** Mapped to HeroUI's onPress. */
  onClick?: () => void;
  className?: string;
  children?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

function WithTitle({ title, children }: { title?: string; children: ReactNode }) {
  if (!title) return children;
  return (
    <Tooltip delay={300}>
      {children}
      <Tooltip.Content>{title}</Tooltip.Content>
    </Tooltip>
  );
}

export function Button({ variant = "secondary", size = "md", icon, loading, disabled, onClick, className, children, title, type = "button", ref, ...rest }: ButtonProps) {
  return (
    <WithTitle title={title}>
      <HeroButton
        ref={ref}
        type={type}
        variant={VARIANT[variant]}
        isPending={loading}
        isDisabled={disabled}
        onPress={onClick}
        className={cn("rounded-control text-body-strong", SIZES[size], className)}
        {...rest}
      >
        {loading ? <Spinner size="sm" color="current" /> : icon}
        {children}
      </HeroButton>
    </WithTitle>
  );
}

export interface IconButtonProps extends Base {
  /** Accessible name and tooltip text. */
  label: string;
  disabled?: boolean;
  onClick?: () => void;
  children?: ReactNode;
  className?: string;
}

/** 32px square ghost button with a tooltip. */
export function IconButton({ label, className, children, disabled, onClick, ...rest }: IconButtonProps) {
  return (
    <Tooltip delay={300}>
      <HeroButton
        isIconOnly
        variant="ghost"
        aria-label={label}
        isDisabled={disabled}
        onPress={onClick}
        className={cn("size-8 min-w-8 rounded-control text-muted md:size-8", className)}
        {...rest}
      >
        {children}
      </HeroButton>
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip>
  );
}
