/** 940 -> "940", 25_100 -> "25.1K", 1_240_000 -> "1.2M". For the big serif figures. */
export function formatCompact(n: number): string {
  const v = Math.max(0, Math.round(n));
  if (v < 1000) return String(v);
  if (v < 1_000_000) return `${trim(v / 1000)}K`;
  return `${trim(v / 1_000_000)}M`;
}

/** One decimal, no trailing ".0", and never rounds up into the next unit's label (999.95K stays 999.9K). */
function trim(x: number): string {
  const floored = Math.floor(x * 10) / 10;
  return Number.isInteger(floored) ? String(floored) : floored.toFixed(1);
}

/** "Welcome back, Maya", or just "Home" when there is no name. */
export function homeTitle(name: string | undefined | null): string {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first ? `Welcome back, ${first}` : "Home";
}
