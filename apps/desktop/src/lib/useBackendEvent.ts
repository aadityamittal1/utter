import { useEffect, useRef } from "react";
import { on } from "./ipc";
import type { EventMap, EventName } from "./types";

/**
 * Subscribe to a backend event for the lifetime of the component.
 * The callback may change every render without resubscribing.
 */
export function useBackendEvent<E extends EventName>(event: E, cb: (payload: EventMap[E]) => void): void {
  const ref = useRef(cb);
  useEffect(() => {
    ref.current = cb;
  });
  useEffect(() => {
    let cancelled = false;
    let off: (() => void) | undefined;
    on(event, (p) => ref.current(p))
      .then((fn) => (cancelled ? fn() : (off = fn)))
      .catch((e) => console.error(`listen(${event}) failed`, e));
    return () => {
      cancelled = true;
      off?.();
    };
  }, [event]);
}
