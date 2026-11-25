import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { IconButton } from "../../../components/ui";

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/** Elements on the page that should take focus when the opener is gone (mark with this attribute). */
export const MODAL_FALLBACK_ATTR = "data-modal-fallback";

/**
 * Minimal accessible modal: Esc closes, Tab stays inside, focus starts inside
 * and returns to the opener (or a `data-modal-fallback` element) on close.
 */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  // Captured during the first render, before any child autoFocus can move focus.
  const [opener] = useState(() => (typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null)));

  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    const root = ref.current;
    if (root && !root.contains(document.activeElement)) {
      const first = root.querySelector<HTMLElement>("input, textarea, select") ?? root.querySelector<HTMLElement>(FOCUSABLE);
      first?.focus();
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
      } else if (e.key === "Tab" && ref.current) {
        const els = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
        if (els.length === 0) return;
        const first = els[0];
        const last = els[els.length - 1];
        const active = document.activeElement;
        if (!ref.current.contains(active)) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const target = opener && opener.isConnected && opener !== document.body ? opener : document.querySelector<HTMLElement>(`[${MODAL_FALLBACK_ATTR}]`);
      target?.focus?.();
    };
  }, [opener]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim)] p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className="page-enter w-full max-w-[520px] rounded-panel border border-line bg-surface p-6 shadow-[var(--shadow-pop)]">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-[26px] leading-none text-ink">{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}
