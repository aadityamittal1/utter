/** The n busiest (day, hour) slots, highest first; empty slots are skipped. Ties keep grid order. */
export function topSlots(data: number[][], n: number): { d: number; h: number; v: number }[] {
  const all: { d: number; h: number; v: number }[] = [];
  data.forEach((row, d) => row.forEach((v, h) => v > 0 && all.push({ d, h, v })));
  return all.sort((a, b) => b.v - a.v).slice(0, n);
}

/** Map a count to a 0-4 intensity bucket (0 = none), as a share of the max cell. */
export function heatLevel(value: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0 || max <= 0) return 0;
  const r = value / max;
  if (r > 0.75) return 4;
  if (r > 0.5) return 3;
  if (r > 0.25) return 2;
  return 1;
}
