import type { InputHTMLAttributes, ReactNode, Ref, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { useId } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/cn";

const CONTROL =
  "w-full rounded-control border border-line bg-surface px-3 text-sm text-ink placeholder:text-faint " +
  "transition-colors hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-0 " +
  "focus-visible:border-transparent disabled:opacity-50";

interface FieldShellProps {
  id: string;
  label?: string;
  helper?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
}

function FieldShell({ id, label, helper, error, children, className }: FieldShellProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label htmlFor={id} className="text-[13px] font-medium text-ink">
          {label}
        </label>
      )}
      {children}
      {error ? (
        <p id={`${id}-err`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : helper ? (
        <p id={`${id}-help`} className="text-xs text-muted">
          {helper}
        </p>
      ) : null}
    </div>
  );
}

type Shared = { label?: string; helper?: ReactNode; error?: string | null };

export function Input({ label, helper, error, className, id, ref, ...rest }: Shared & InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldShell id={fid} label={label} helper={helper} error={error} className={className}>
      <input
        ref={ref}
        id={fid}
        aria-invalid={!!error}
        aria-describedby={error ? `${fid}-err` : helper ? `${fid}-help` : undefined}
        className={cn(CONTROL, "h-9", error && "border-danger")}
        {...rest}
      />
    </FieldShell>
  );
}

export function Textarea({ label, helper, error, className, id, rows = 4, ref, ...rest }: Shared & TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldShell id={fid} label={label} helper={helper} error={error} className={className}>
      <textarea
        ref={ref}
        id={fid}
        rows={rows}
        aria-invalid={!!error}
        aria-describedby={error ? `${fid}-err` : helper ? `${fid}-help` : undefined}
        className={cn(CONTROL, "resize-y py-2 leading-relaxed", error && "border-danger")}
        {...rest}
      />
    </FieldShell>
  );
}

export function Select({ label, helper, error, className, id, children, ...rest }: Shared & SelectHTMLAttributes<HTMLSelectElement>) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldShell id={fid} label={label} helper={helper} error={error} className={className}>
      <div className="relative">
        <select id={fid} aria-invalid={!!error} className={cn(CONTROL, "h-9 appearance-none pr-9", error && "border-danger")} {...rest}>
          {children}
        </select>
        <ChevronDown size={15} aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-faint" />
      </div>
    </FieldShell>
  );
}
