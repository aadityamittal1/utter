/**
 * Debounced saver that never drops the last edit: `flush()` runs a pending
 * save immediately (call it when switching notes or unmounting).
 */
export interface Autosaver<T> {
  schedule: (value: T) => void;
  flush: () => Promise<void>;
  cancel: () => void;
  hasPending: () => boolean;
}

export function createAutosaver<T>(save: (value: T) => Promise<unknown> | unknown, delayMs = 500): Autosaver<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { value: T } | null = null;

  const run = async () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!pending) return;
    const { value } = pending;
    pending = null;
    await save(value);
  };

  return {
    schedule(value) {
      pending = { value };
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void run(), delayMs);
    },
    flush: run,
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    },
    hasPending: () => pending !== null,
  };
}

/** First non-empty line, for a list preview. */
export function previewLine(body: string): string {
  const line = body.split("\n").find((l) => l.trim());
  return line?.trim() ?? "";
}
