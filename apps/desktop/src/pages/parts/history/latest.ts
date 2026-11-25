/** Request-sequence guard: only the most recently started request may apply its result. */
export function createLatestGuard() {
  let seq = 0;
  return {
    /** Start a request; returns a function telling whether it is still the latest. */
    next(): () => boolean {
      const mine = ++seq;
      return () => mine === seq;
    },
  };
}
