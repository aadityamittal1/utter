export const TRIGGER_MAX = 60;
export const EXPANSION_MAX = 4000;

export interface Preset {
  label: string;
  trigger: string;
  placeholder: string;
}

export const PRESETS: Preset[] = [
  { label: "LinkedIn", trigger: "my linkedin", placeholder: "https://www.linkedin.com/in/your-name" },
  { label: "Email", trigger: "my email", placeholder: "you@example.com" },
  { label: "Website", trigger: "my website", placeholder: "https://example.com" },
  { label: "Calendar link", trigger: "my calendar link", placeholder: "https://cal.com/your-name/30min" },
];

/** Presets whose trigger is not already taken (case-insensitive). */
export function availablePresets(triggers: string[]): Preset[] {
  const taken = new Set(triggers.map((t) => t.trim().toLowerCase()));
  return PRESETS.filter((p) => !taken.has(p.trigger));
}

export function validateSnippet(trigger: string, expansion: string): string | null {
  const t = trigger.trim();
  if (!t) return "Enter the phrase you'll say.";
  if (t.length > TRIGGER_MAX) return `The phrase must be ${TRIGGER_MAX} characters or fewer (now ${t.length}).`;
  if (!expansion.trim()) return "Enter the text to insert.";
  if (expansion.length > EXPANSION_MAX) return `The text must be ${EXPANSION_MAX.toLocaleString("en-US")} characters or fewer (now ${expansion.length.toLocaleString("en-US")}).`;
  return null;
}
