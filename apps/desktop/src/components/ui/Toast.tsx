import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { useToasts, type ToastKind } from "../../lib/store";
import { cn } from "../../lib/cn";

const ICONS: Record<ToastKind, typeof Info> = { info: Info, success: CheckCircle2, error: AlertCircle };
const TONE: Record<ToastKind, string> = { info: "text-muted", success: "text-success", error: "text-danger" };

export function ToastHost() {
  const { items, dismiss } = useToasts();
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-50 flex w-[340px] flex-col gap-2" aria-live="polite">
      {items.map((t) => {
        const Icon = ICONS[t.kind];
        return (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className="toast-enter pointer-events-auto flex items-start gap-2.5 rounded-card bg-surface px-3.5 py-3 text-[13px] text-ink shadow-[var(--shadow-pop)]"
          >
            <Icon size={16} aria-hidden className={cn("mt-px shrink-0", TONE[t.kind])} />
            <span className="min-w-0 flex-1">{t.message}</span>
            <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="rounded p-0.5 text-faint hover:text-ink">
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
