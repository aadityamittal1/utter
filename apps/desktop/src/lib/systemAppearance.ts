// Feeds appearance.ts from the backend: initial snapshot plus live events.
import { ipc, on } from "./ipc";
import { setBackdrop, setSystemAccent, setTextScale } from "./appearance";

/** Call once per window that follows the system (the hub). Failures are ignored: defaults apply. */
export function startSystemAppearance(): void {
  ipc
    .getSystemAppearance()
    .then((s) => {
      setSystemAccent(s.accent);
      setTextScale(s.textScale);
      setBackdrop(s.backdrop);
    })
    .catch(() => undefined);
  void on("system://accent", (a) => setSystemAccent(a)).catch(() => undefined);
  void on("system://text-scale", ({ factor }) => setTextScale(factor)).catch(() => undefined);
  void on("system://backdrop", ({ kind }) => setBackdrop(kind)).catch(() => undefined);
}
