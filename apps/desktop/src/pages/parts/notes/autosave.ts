/**
 * Debounced, serialized saver that never drops the last edit.
 * - Saves never overlap; the newest value always wins.
 * - `save` may throw: the value stays pending and is retried on the next edit or flush.
 * - `flush()` runs a pending save now (call on note switch / unmount / before delete).
 */
export interface Autosaver<T> {
  schedule: (value: T) => void;
  /** Resolves true when nothing is left unsaved. */
  flush: () => Promise<boolean>;
  cancel: () => void;
  hasPending: () => boolean;
}

export function createAutosaver<T>(save: (value: T) => Promise<unknown> | unknown, delayMs = 500): Autosaver<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { value: T } | null = null;
  let running: Promise<void> | null = null;

  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const drain = async () => {
    // Loop so an edit made during a save is saved right after it, in order.
    while (pending) {
      const { value } = pending;
      pending = null;
      try {
        await save(value);
      } catch {
        if (!pending) pending = { value }; // keep it for the next edit or flush
        return;
      }
    }
  };

  const run = (): Promise<void> => {
    clear();
    if (!running) {
      running = drain().finally(() => {
        running = null;
      });
    }
    return running;
  };

  return {
    schedule(value) {
      pending = { value };
      clear();
      // While a save is in flight, drain's loop picks the new value up afterwards.
      timer = setTimeout(() => void run(), delayMs);
    },
    async flush() {
      await run();
      // An edit made while the last save ran is handled by drain; a failed one stays pending.
      return pending === null;
    },
    cancel() {
      clear();
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
