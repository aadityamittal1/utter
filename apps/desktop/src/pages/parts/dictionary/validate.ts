export const WORD_MAX = 60;

/** Returns a user-facing message, or null when the entry is fine to submit. */
export function validateWord(word: string, heardAs: string): string | null {
  const w = word.trim();
  if (!w) return "Enter a word.";
  if (w.length > WORD_MAX) return `Keep it to ${WORD_MAX} characters or fewer (now ${w.length}).`;
  const h = heardAs.trim();
  if (h.length > WORD_MAX) return `"Heard as" must be ${WORD_MAX} characters or fewer.`;
  if (h && h.toLowerCase() === w.toLowerCase()) return '"Heard as" is the same as the word. Nothing to correct.';
  return null;
}
