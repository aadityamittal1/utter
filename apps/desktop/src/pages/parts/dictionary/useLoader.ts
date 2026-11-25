import { useCallback, useEffect, useRef, useState } from "react";

/** Turn a rejected IPC value (a user-facing string) or Error into display text. */
export const errText = (e: unknown, fallback = "Something went wrong"): string => (typeof e === "string" ? e : e instanceof Error ? e.message : fallback);

/**
 * Load a list from the backend. `fetcher` must be a stable function (e.g. an `ipc.*` method).
 * Results of superseded requests, and results arriving after unmount, are ignored,
 * so overlapping reloads can never bring back deleted rows.
 */
export function useLoader<T>(fetcher: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false; // nothing in flight may apply after unmount
    };
  }, []);

  const reload = useCallback(() => {
    const mine = ++seq.current;
    return fetcher().then(
      (d) => {
        if (!alive.current || seq.current !== mine) return;
        setData(d);
        setError(null);
      },
      (e) => {
        if (!alive.current || seq.current !== mine) return;
        setError(errText(e));
      },
    );
  }, [fetcher]);

  /** Local edits (optimistic removes) also supersede any request still in flight. */
  const set = useCallback((u: T | null | ((cur: T | null) => T | null)) => {
    seq.current++;
    setData(u);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, setData: set, error, reload };
}
