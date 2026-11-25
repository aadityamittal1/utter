import { useRef } from "react";
import type { ReactNode } from "react";
import { Button } from "../../../components/ui";

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

/** A button that opens a hidden file input and hands back the chosen file's text. */
export function ImportButton({ onText, children, disabled }: { onText: (text: string) => void | Promise<void>; children: ReactNode; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept=".csv,text/csv,text/plain"
        hidden
        data-testid="import-input"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) await onText(await file.text());
        }}
      />
      <Button size="sm" disabled={disabled} onClick={() => ref.current?.click()}>
        {children}
      </Button>
    </>
  );
}
