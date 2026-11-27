/** Semicircle gauge: `value` of `max`, ember on a raised track. The figure sits inside the arc. */
export function Gauge({ value, max, label, children }: { value: number; max: number; label: string; children: React.ReactNode }) {
  const share = Math.max(0, Math.min(1, value / max));
  const arc = "M 14 94 A 80 80 0 0 1 174 94";
  return (
    <div role="img" aria-label={label} className="relative mx-auto w-full max-w-[188px]">
      <svg viewBox="0 0 188 104" className="block w-full" aria-hidden>
        <path d={arc} pathLength={100} fill="none" strokeWidth={16} strokeLinecap="round" stroke="var(--surface-tertiary)" />
        {share > 0 && (
          <path
            d={arc}
            pathLength={100}
            fill="none"
            strokeWidth={16}
            strokeLinecap="round"
            stroke="var(--ember)"
            strokeDasharray={`${share * 100} 100`}
            className="transition-[stroke-dasharray] duration-[333ms] ease-fluent"
          />
        )}
      </svg>
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center text-center">{children}</div>
    </div>
  );
}
