export type DiffOp = { kind: "same" | "del" | "add"; text: string };

/** Word-level diff (LCS). Tokens are whitespace-separated words; ops keep original order. */
export function wordDiff(a: string, b: string): DiffOp[] {
  const x = a.split(/\s+/).filter(Boolean);
  const y = b.split(/\s+/).filter(Boolean);
  const n = x.length;
  const m = y.length;
  const t: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      t[i][j] = x[i] === y[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
    }
  }
  const raw: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      raw.push({ kind: "same", text: x[i] });
      i++;
      j++;
    } else if (t[i + 1][j] >= t[i][j + 1]) {
      raw.push({ kind: "del", text: x[i++] });
    } else {
      raw.push({ kind: "add", text: y[j++] });
    }
  }
  while (i < n) raw.push({ kind: "del", text: x[i++] });
  while (j < m) raw.push({ kind: "add", text: y[j++] });
  // merge adjacent ops of the same kind
  const out: DiffOp[] = [];
  for (const op of raw) {
    const last = out[out.length - 1];
    if (last && last.kind === op.kind) last.text += ` ${op.text}`;
    else out.push({ ...op });
  }
  return out;
}
