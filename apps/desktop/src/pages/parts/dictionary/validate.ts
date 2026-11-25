export const WORD_MAX = 60;
/** Show a running count once a field is this close to the limit. */
export const COUNT_FROM = 45;

export interface EntryErrors {
  word?: string;
  heardAs?: string;
}

/** Field-level messages for a new entry. An empty object means it is fine to submit. */
export function validateEntry(word: string, heardAs: string): EntryErrors {
  const w = word.trim();
  const h = heardAs.trim();
  const errors: EntryErrors = {};
  if (!w) errors.word = "Enter a word.";
  else if (w.length > WORD_MAX) errors.word = `Keep it to ${WORD_MAX} characters or fewer (now ${w.length}).`;
  if (h.length > WORD_MAX) errors.heardAs = `Keep it to ${WORD_MAX} characters or fewer (now ${h.length}).`;
  else if (h && w && h.toLowerCase() === w.toLowerCase()) errors.heardAs = "This is the same as the word, so there is nothing to correct.";
  return errors;
}

/** "52/60" once near the limit, otherwise nothing. */
export function countLabel(value: string): string | undefined {
  const n = value.trim().length;
  return n >= COUNT_FROM ? `${n}/${WORD_MAX}` : undefined;
}
