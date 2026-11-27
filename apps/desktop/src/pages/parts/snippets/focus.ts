/**
 * After a dialog closes, focus returns to whatever opened it. When that element has been
 * removed meanwhile (a quick-add chip disappears once its snippet exists), send focus to
 * `fallback` instead, so keyboard users do not land on the page body.
 * Waits `delay` ms so it runs after the dialog's own focus restore. Returns a cancel function.
 */
export function focusFallback(opener: HTMLElement | null, fallback: () => HTMLElement | null, delay = 250): () => void {
  const t = setTimeout(() => {
    if (opener?.isConnected) return;
    fallback()?.focus();
  }, delay);
  return () => clearTimeout(t);
}
