import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "../../../components/ui";
import { toast } from "../../../lib/store";
import { errText } from "./useLoader";

/** Trigger a browser download of text content (works in the Tauri webview and a plain browser). */
export function downloadText(filename: string, text: string, mime = "text/csv"): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * A button that opens a hidden file input and hands back the chosen file's text.
 * Shows a busy state while reading and importing; reading failures become a toast.
 */
export function ImportButton({ onText, children, disabled, variant = "primary" }: { onText: (text: string) => void | Promise<void>; children: ReactNode; disabled?: boolean; variant?: "primary" | "secondary" }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept=".csv,text/csv,text/plain"
        hidden
        data-testid="import-input"
        onChange={async (e) => {
          const input = e.target;
          const file = input.files?.[0];
          if (!file) return;
          setBusy(true);
          try {
            const text = await file.text();
            await onText(text);
          } catch (err) {
            toast.error(errText(err, "Couldn't read that file"));
          } finally {
            input.value = "";
            setBusy(false);
          }
        }}
      />
      <Button variant={variant} loading={busy} disabled={disabled} onClick={() => ref.current?.click()}>
        {children}
      </Button>
    </>
  );
}
