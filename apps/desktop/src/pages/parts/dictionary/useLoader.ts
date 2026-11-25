import { useCallback, useEffect, useState } from "react";

const errText = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : "Something went wrong");

/** Load a list from the backend. `fetcher` must be a stable function (e.g. an `ipc.*` method). */
export function useLoader<T>(fetcher: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(
    () =>
      fetcher().then(
        (d) => {
          setData(d);
          setError(null);
        },
        (e) => setError(errText(e)),
      ),
    [fetcher],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, setData, error, reload };
}
