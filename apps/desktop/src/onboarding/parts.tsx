import type { ReactNode } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "../components/ui";
import type { ModelProgress } from "../lib/types";

export interface StepProps {
  next: () => void;
  back: () => void;
  /** Background speech-model download, owned by the shell so it survives step changes. */
  download: DownloadState;
}

export interface DownloadState {
  modelId: string | null;
  progress: ModelProgress | null;
  error: string | null;
  start: (id: string) => Promise<void>;
}

export function StepFrame({ eyebrow, title, subtitle, children }: { eyebrow?: string; title: ReactNode; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      {eyebrow && <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-accent">{eyebrow}</p>}
      <h1 className="font-display text-[40px] leading-[1.1] text-ink">{title}</h1>
      {subtitle && <p className="mt-3 max-w-[52ch] text-[15px] leading-relaxed text-muted">{subtitle}</p>}
      <div className="mt-7">{children}</div>
    </div>
  );
}

export function StepFooter({
  onBack,
  onNext,
  nextLabel = "Continue",
  nextDisabled,
  loading,
  secondary,
  nextVariant = "primary",
}: {
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  loading?: boolean;
  secondary?: ReactNode;
  nextVariant?: "primary" | "secondary";
}) {
  return (
    <div className="mt-9 flex items-center gap-3">
      {onBack && (
        <Button variant="ghost" onClick={onBack} icon={<ArrowLeft size={15} aria-hidden />}>
          Back
        </Button>
      )}
      <div className="flex-1" />
      {secondary}
      <Button variant={nextVariant} onClick={onNext} disabled={nextDisabled} loading={loading} className="min-w-28">
        {nextLabel}
        {!loading && <ArrowRight size={15} aria-hidden />}
      </Button>
    </div>
  );
}
