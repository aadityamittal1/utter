import type { Category, StyleKind } from "../../../lib/types";
import { STYLE_KINDS } from "../../../lib/types";

export const STYLE_LABELS: Record<StyleKind, string> = {
  formal: "Formal",
  casual: "Casual",
  veryCasual: "Very casual",
  excited: "Excited",
};

export const CATEGORY_LABELS: Record<Category, string> = {
  email: "Email",
  workChat: "Work chat",
  personalChat: "Personal chat",
  aiPrompt: "AI prompts",
  code: "Code",
  document: "Documents",
  other: "Other",
};

export const CATEGORY_HINTS: Record<Category, string> = {
  email: "Outlook, Gmail and other mail apps",
  workChat: "Slack, Teams and similar",
  personalChat: "WhatsApp, Messages, Discord",
  aiPrompt: "Chats with an AI assistant",
  code: "Editors and terminals",
  document: "Word, Notion, Docs",
  other: "Everything else",
};

/** What the user said, per category: a greeting name and the request. */
const SAMPLES: Record<Category, { name: string; task: string }> = {
  email: { name: "Priya", task: "send me the contract by Friday" },
  workChat: { name: "team", task: "review the launch checklist before standup" },
  personalChat: { name: "Sam", task: "grab me a coffee on your way" },
  aiPrompt: { name: "", task: "summarize this thread in three bullets" },
  code: { name: "", task: "add a test for the empty case" },
  document: { name: "", task: "move the budget section above the timeline" },
  other: { name: "Alex", task: "send me the address tonight" },
};

/** Whether a style can be picked for a category. */
export function isStyleAllowed(category: Category, style: StyleKind): boolean {
  if (style === "veryCasual") return category === "personalChat";
  if (style === "excited") return category !== "personalChat";
  return true;
}

export function allowedStyles(category: Category): StyleKind[] {
  return STYLE_KINDS.filter((s) => isStyleAllowed(category, s));
}

/**
 * Arrow-key target within a category's radio group (wraps, skips unavailable styles).
 * Returns null for any other key.
 */
export function nextStyle(category: Category, current: StyleKind, key: string): StyleKind | null {
  const forward = key === "ArrowRight" || key === "ArrowDown";
  const back = key === "ArrowLeft" || key === "ArrowUp";
  if (!forward && !back) return null;
  const list = allowedStyles(category);
  const i = list.indexOf(current);
  if (i < 0) return list[forward ? 0 : list.length - 1];
  return list[(i + (forward ? 1 : -1) + list.length) % list.length];
}

/** Why a style is unavailable, or null when it is allowed. */
export function disabledReason(category: Category, style: StyleKind): string | null {
  if (isStyleAllowed(category, style)) return null;
  return style === "veryCasual" ? "Very casual is only for Personal chat" : "Excited is not offered for Personal chat";
}

/** The same request rendered in each style. Pure, so it is easy to test. */
export function renderExample(style: StyleKind, category: Category): string {
  const { name, task } = SAMPLES[category];
  const to = (sep: string) => (name ? `${sep}${name}` : "");
  switch (style) {
    case "formal":
      return `Hello${to(" ")}, could you please ${task}? Thank you.`;
    case "casual":
      return `Hey${to(" ")}, can you ${task}? Thanks!`;
    case "veryCasual":
      return `hey${to(" ").toLowerCase()} can you ${task.toLowerCase()} thx`;
    case "excited":
      return `Hey${to(" ")}, can you ${task}? Thanks so much!!`;
  }
}

/** One-line description of how each style writes (the card sub-line). */
export const STYLE_TRAITS: Record<StyleKind, string> = {
  formal: "Capitals and full punctuation",
  casual: "Capitals and lighter punctuation",
  veryCasual: "No capitals, lighter punctuation",
  excited: "Capitals and exclamation marks",
};

export type ContextTab = "personal" | "work" | "email" | "other";

/** The four tabs, and which app types each one edits. "other" groups the rarely changed ones. */
export const CONTEXT_TABS: { id: ContextTab; label: string; categories: Category[] }[] = [
  { id: "personal", label: "Personal messages", categories: ["personalChat"] },
  { id: "work", label: "Work messages", categories: ["workChat"] },
  { id: "email", label: "Email", categories: ["email"] },
  { id: "other", label: "Other", categories: ["other", "aiPrompt", "code", "document"] },
];

/** Headline for the banner above a category's style cards. */
export const BANNER_TITLES: Record<Category, string> = {
  personalChat: "This style applies in personal messengers",
  workChat: "This style applies in work chat",
  email: "This style applies in email",
  aiPrompt: "This style applies when you prompt an AI",
  code: "This style applies in editors and terminals",
  document: "This style applies in documents",
  other: "This style applies everywhere else",
};

/** Example apps shown as plain text chips. The match itself is by app, window title and your rules. */
export const CATEGORY_APPS: Record<Category, string[]> = {
  personalChat: ["WhatsApp", "Messages", "Discord", "Telegram"],
  workChat: ["Slack", "Teams", "Zoom chat"],
  email: ["Outlook", "Gmail", "Thunderbird"],
  aiPrompt: ["Claude", "ChatGPT", "Gemini"],
  code: ["VS Code", "Terminal", "JetBrains"],
  document: ["Word", "Notion", "Google Docs"],
  other: ["Any other app"],
};
