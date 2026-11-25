import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "../../lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-ember text-on-accent hover:bg-[var(--accent-fill-hover)] border border-transparent font-semibold",
  secondary: "bg-surface text-ink border border-line hover:bg-hover hover:border-line-strong",
  ghost: "bg-transparent text-muted border border-transparent hover:bg-hover hover:text-ink",
  danger: "bg-transparent text-danger border border-line hover:bg-danger-soft hover:border-danger",
};
const SIZES: Record<Size, string> = {
  sm: "h-7 px-2.5 text-[13px] gap-1.5 rounded-control",
  md: "h-9 px-3.5 text-sm gap-2 rounded-control",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  loading?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({ variant = "secondary", size = "md", icon, loading, className, children, disabled, type = "button", ref, ...rest }: ButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap font-medium select-none",
        "transition-[background-color,border-color,color,transform] duration-150 active:translate-y-px",
        "disabled:opacity-50 disabled:pointer-events-none",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 size={15} className="animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-control text-muted transition-colors",
        "hover:bg-hover hover:text-ink active:translate-y-px disabled:opacity-50 disabled:pointer-events-none",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
