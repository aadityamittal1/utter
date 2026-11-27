// TypeScript mirrors of the Rust IPC contract (camelCase over the wire).

export type Category = "email" | "workChat" | "personalChat" | "aiPrompt" | "code" | "document" | "other";
export const CATEGORIES: Category[] = ["email", "workChat", "personalChat", "aiPrompt", "code", "document", "other"];

export type StyleKind = "formal" | "casual" | "veryCasual" | "excited";
export const STYLE_KINDS: StyleKind[] = ["formal", "casual", "veryCasual", "excited"];

export type CleanupLevel = "off" | "light" | "medium";

export type Action =
  | "dictate"
  | "handsFree"
  | "dictateEnhance"
  | "command"
  | "cancel"
  | "pasteLast"
  | "copyLast"
  | "quickNote"
  | `transform:${string}`;

export interface CategoryRule {
  category: Category;
  process?: string;
  titleContains?: string;
}

export type ThemePref = "system" | "light" | "dark";
export type AccentSource = "utter" | "windows";

/** Windows accent shades as #rrggbb (UISettings.GetColorValue). */
export interface SystemAccent {
  accent: string;
  light1: string;
  light2: string;
  light3: string;
  dark1: string;
  dark2: string;
  dark3: string;
}
export type BackdropKind = "mica" | "solid";
export interface SystemAppearance {
  accent: SystemAccent | null;
  textScale: number;
  backdrop: BackdropKind;
}
export type HistoryRetention = "forever" | "day" | "never";

export interface Settings {
  onboarded: boolean;
  userName: string;
  /** Each entry is a full chord string like "Ctrl+Win" (alternative bindings). */
  shortcuts: Partial<Record<Action, string[]>>;
  microphone: string | null;
  keepMicWarm: boolean;
  language: string; // "auto" | iso639
  translateToEnglish: boolean;
  activeModel: string;
  aiModel: string;
  cleanupLevel: CleanupLevel;
  styles: Record<Category, StyleKind>;
  autoEnhance: Category[];
  contextAwareness: boolean;
  sounds: boolean;
  showPill: boolean;
  launchAtLogin: boolean;
  theme: ThemePref;
  accentSource: AccentSource;
  historyRetention: HistoryRetention;
  keepAudio: boolean;
  categoryRules: CategoryRule[];
}

export type HistoryMode = "dictate" | "dictateEnhance" | "command" | "transform";

export interface HistoryItem {
  id: string;
  createdAt: number;
  appName: string;
  category: Category;
  mode: HistoryMode;
  rawText: string;
  finalText: string;
  durationMs: number;
  words: number;
  usedAi: boolean;
  hasAudio: boolean;
  error?: string;
}

export interface DictEntry {
  id: string;
  word: string;
  heardAs?: string;
  auto: boolean;
}

export interface Snippet {
  id: string;
  trigger: string;
  expansion: string;
}

export interface Transform {
  id: string;
  name: string;
  instruction: string;
  shortcut?: string;
  builtin: boolean;
}

export interface Note {
  id: string;
  title: string;
  body: string;
  updatedAt: number;
}

export interface ModelStatus {
  id: string;
  label: string;
  sizeBytes: number;
  multilingual: boolean;
  recommended: boolean;
  downloaded: boolean;
  active: boolean;
}

export interface Insights {
  totalWords: number;
  weekWords: number;
  avgWpm: number;
  timeSavedMin: number;
  currentStreak: number;
  longestStreak: number;
  heatmap: number[][]; // [7][24]
  topApps: { name: string; words: number }[];
  categories: { category: Category; words: number }[];
}

export interface Usage {
  monthInputTokens: number;
  monthOutputTokens: number;
  estCostUsd: number;
}

export type PillStateKind = "idle" | "listening" | "locked" | "thinking" | "done" | "error";

export interface PillState {
  state: PillStateKind;
  mode: string;
  elapsedMs: number;
  message?: string;
  /** True only for transcription failures that can be retried. Absent means false. */
  retryable?: boolean;
}

export interface ApiKeyStatus {
  set: boolean;
  last4?: string;
}

export interface ModelProgress {
  id: string;
  downloaded: number;
  total: number;
  done: boolean;
  error?: string;
}

export type PillAction = "start" | "toggle" | "stop" | "cancel" | "retry" | "hide1h" | "openHub" | "openSettings" | "menuOpen" | "menuClose";

export interface EventMap {
  "pill://state": PillState;
  "pill://levels": number[];
  "pill://hover": { hover: boolean };
  "mic://level": number;
  "model://progress": ModelProgress;
  "shortcut://captured": { chord: string };
  "history://changed": undefined;
  "settings://changed": Settings;
  "hub://navigate": { page: string };
  "system://accent": SystemAccent;
  "system://text-scale": { factor: number };
  "system://backdrop": { kind: BackdropKind };
}
export type EventName = keyof EventMap;

export type Page =
  | "home"
  | "history"
  | "dictionary"
  | "snippets"
  | "styles"
  | "transforms"
  | "notes"
  | "insights"
  | "settings";
