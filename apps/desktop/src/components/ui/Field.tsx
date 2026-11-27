import { Children, isValidElement, useId } from "react";
import type { InputHTMLAttributes, ReactElement, ReactNode, Ref, TextareaHTMLAttributes } from "react";
import { Input as HeroInput, Label, ListBox, Select as HeroSelect, TextArea as HeroTextArea } from "@heroui/react";
import { cn } from "../../lib/cn";

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
        <label htmlFor={id} className="text-body-strong text-ink">
          {label}
        </label>
      )}
      {children}
      {error ? (
        <p id={`${id}-err`} role="alert" className="text-caption text-danger">
          {error}
        </p>
      ) : helper ? (
        <p id={`${id}-help`} className="text-caption text-muted">
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
      <HeroInput
        ref={ref}
        id={fid}
        fullWidth
        aria-invalid={!!error}
        aria-describedby={error ? `${fid}-err` : helper ? `${fid}-help` : undefined}
        className={cn("h-10 rounded-control px-3 text-body", error && "border-danger")}
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
      <HeroTextArea
        ref={ref}
        id={fid}
        fullWidth
        rows={rows}
        aria-invalid={!!error}
        aria-describedby={error ? `${fid}-err` : helper ? `${fid}-help` : undefined}
        className={cn("resize-y rounded-control px-3 py-2 text-body", error && "border-danger")}
        {...rest}
      />
    </FieldShell>
  );
}

// ---- Select ----------------------------------------------------------------

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Shared {
  value?: string;
  /** Native-shaped event so call sites read `e.target.value`. */
  onChange?: (e: { target: { value: string } }) => void;
  /** Options as data, or as native `<option>` children. */
  options?: SelectOption[];
  children?: ReactNode;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  id?: string;
  "aria-label"?: string;
}

// React Aria treats "" poorly as a key, so the empty value gets a stand-in.
const EMPTY = "__empty__";
const toKey = (v: string) => (v === "" ? EMPTY : v);
const fromKey = (k: string) => (k === EMPTY ? "" : k);

function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return "";
}

function optionsFromChildren(children: ReactNode): SelectOption[] {
  return Children.toArray(children).flatMap((c) => {
    if (!isValidElement(c) || c.type !== "option") return [];
    const p = (c as ReactElement<{ value?: string | number; disabled?: boolean; children?: ReactNode }>).props;
    const label = textOf(p.children);
    return [{ value: p.value === undefined ? label : String(p.value), label, disabled: p.disabled }];
  });
}

/** HeroUI Select with a native-select-shaped API (value, onChange, `<option>` children). */
export function Select({ label, helper, error, className, id, value, onChange, options, children, disabled, placeholder, "aria-label": ariaLabel }: SelectProps) {
  const opts = options ?? optionsFromChildren(children);
  const selected = value === undefined ? undefined : toKey(value);
  const known = selected !== undefined && opts.some((o) => toKey(o.value) === selected);
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <HeroSelect
        id={id}
        fullWidth
        placeholder={placeholder ?? "Select"}
        value={known ? selected : null}
        onChange={(k) => k !== null && onChange?.({ target: { value: fromKey(String(k)) } })}
        isDisabled={disabled}
        isInvalid={!!error}
        aria-label={label ? undefined : ariaLabel}
      >
        {label && <Label className="text-body-strong text-ink">{label}</Label>}
        <HeroSelect.Trigger className="h-10 rounded-control px-3 text-body">
          <HeroSelect.Value />
          <HeroSelect.Indicator />
        </HeroSelect.Trigger>
        <HeroSelect.Popover className="rounded-control">
          <ListBox>
            {opts.map((o) => (
              <ListBox.Item key={toKey(o.value)} id={toKey(o.value)} textValue={o.label} isDisabled={o.disabled} className="rounded-md">
                {o.label}
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </HeroSelect.Popover>
      </HeroSelect>
      {error ? (
        <p role="alert" className="text-caption text-danger">
          {error}
        </p>
      ) : helper ? (
        <p className="text-caption text-muted">{helper}</p>
      ) : null}
    </div>
  );
}
