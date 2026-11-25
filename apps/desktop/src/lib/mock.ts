// In-memory backend used when the hub runs in a plain browser (no Tauri).
// Mirrors the Rust command surface closely enough for every page to work.

import type {
  Category,
  DictEntry,
  EventMap,
  EventName,
  HistoryItem,
  HistoryMode,
  Insights,
  ModelProgress,
  ModelStatus,
  Note,
  PillState,
  Settings,
  Snippet,
  Transform,
  Usage,
} from "./types";

type Args = Record<string, unknown>;
type Listener = (payload: never) => void;

const DAY = 86_400_000;
let idCounter = 1000;
const nextId = (p: string) => `${p}_${(idCounter++).toString(36)}`;

// deterministic PRNG so the demo data is stable between reloads
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const APPS: { name: string; category: Category }[] = [
  { name: "Outlook", category: "email" },
  { name: "Slack", category: "workChat" },
  { name: "Microsoft Teams", category: "workChat" },
  { name: "WhatsApp", category: "personalChat" },
  { name: "Claude", category: "aiPrompt" },
  { name: "VS Code", category: "code" },
  { name: "Word", category: "document" },
  { name: "Notion", category: "document" },
  { name: "Chrome", category: "other" },
];

const SAMPLES: { raw: string; final: string }[] = [
  {
    raw: "hey priya um just wanted to follow up on the launch checklist can you send me the final copy by thursday",
    final: "Hey Priya, just wanted to follow up on the launch checklist. Can you send me the final copy by Thursday?",
  },
  {
    raw: "thanks for the quick turnaround i'll review the draft this afternoon and flag anything that needs another pass",
    final: "Thanks for the quick turnaround. I'll review the draft this afternoon and flag anything that needs another pass.",
  },
  {
    raw: "so the bug is that the retry timer never resets after a successful reconnect which is why the pill gets stuck",
    final: "The bug is that the retry timer never resets after a successful reconnect, which is why the pill gets stuck.",
  },
  {
    raw: "can you summarize this thread in three bullet points and keep the tone neutral",
    final: "Can you summarize this thread in three bullet points and keep the tone neutral?",
  },
  {
    raw: "running ten minutes late grab me a table and i'll be there",
    final: "Running ten minutes late. Grab me a table and I'll be there.",
  },
  {
    raw: "the quarterly numbers look solid revenue is up eight percent and churn dropped for the second month in a row",
    final: "The quarterly numbers look solid. Revenue is up 8%, and churn dropped for the second month in a row.",
  },
  {
    raw: "refactor the settings store so it debounces writes and add a test for the empty case",
    final: "Refactor the settings store so it debounces writes, and add a test for the empty case.",
  },
  {
    raw: "good morning everyone quick reminder that the demo is moved to two pm in the big room",
    final: "Good morning everyone, quick reminder that the demo is moved to 2 PM in the big room.",
  },
  {
    raw: "dear mister okafor thank you for meeting with us last week we enjoyed learning about your roadmap",
    final: "Dear Mr. Okafor, thank you for meeting with us last week. We enjoyed learning about your roadmap.",
  },
  {
    raw: "remember to pick up oat milk and the dry cleaning on the way home",
    final: "Remember to pick up oat milk and the dry cleaning on the way home.",
  },
];

function seedHistory(now: number): HistoryItem[] {
  const r = rng(7);
  const items: HistoryItem[] = [];
  for (let i = 0; i < 40; i++) {
    const day = Math.floor((i / 40) * 10);
    const app = APPS[Math.floor(r() * APPS.length)];
    const sample = SAMPLES[Math.floor(r() * SAMPLES.length)];
    const hour = 8 + Math.floor(r() * 11);
    const minute = Math.floor(r() * 60);
    const d = new Date(now - day * DAY);
    d.setHours(hour, minute, Math.floor(r() * 60), 0);
    let createdAt = d.getTime();
    if (createdAt > now) createdAt = now - Math.floor(r() * 3_600_000) - 60_000;
    const words = sample.final.split(/\s+/).length;
    const mode: HistoryMode = r() < 0.18 ? "dictateEnhance" : r() < 0.08 ? "command" : "dictate";
    items.push({
      id: `h_${i + 1}`,
      createdAt,
      appName: app.name,
      category: app.category,
      mode,
      rawText: sample.raw,
      finalText: sample.final,
      durationMs: Math.round((words / (130 + r() * 40)) * 60_000),
      words,
      usedAi: mode !== "dictate" || r() < 0.7,
      hasAudio: r() < 0.3,
      error: i === 11 ? "Claude didn't respond in time. Used local cleanup instead." : undefined,
    });
  }
  return items.sort((a, b) => b.createdAt - a.createdAt);
}

const DEFAULT_SHORTCUTS: Record<string, string[]> = {
  dictate: ["Ctrl", "Win"],
  handsFree: ["Ctrl", "Win", "Space"],
  dictateEnhance: ["Ctrl", "Win", "Shift"],
  command: ["Ctrl", "Win", "Alt"],
  cancel: ["Esc"],
  pasteLast: ["Alt", "Shift", "Z"],
  copyLast: ["Alt", "Shift", "C"],
  quickNote: ["Alt", "Shift", "N"],
};

function defaultSettings(): Settings {
  return {
    onboarded: true,
    userName: "Maya",
    shortcuts: structuredClone(DEFAULT_SHORTCUTS),
    microphone: null,
    keepMicWarm: false,
    language: "auto",
    translateToEnglish: false,
    activeModel: "small.en",
    aiModel: "claude-haiku-5-5",
    cleanupLevel: "medium",
    styles: {
      email: "formal",
      workChat: "casual",
      personalChat: "veryCasual",
      aiPrompt: "casual",
      code: "casual",
      document: "formal",
      other: "casual",
    },
    autoEnhance: ["email", "document"],
    contextAwareness: true,
    sounds: true,
    showPill: true,
    launchAtLogin: false,
    theme: "system",
    historyRetention: "forever",
    keepAudio: false,
    categoryRules: [{ category: "aiPrompt", process: "claude.exe" }],
  };
}

function seedModels(): ModelStatus[] {
  return [
    { id: "tiny.en", label: "Tiny (English)", sizeBytes: 77_700_000, multilingual: false, recommended: false, downloaded: true, active: false },
    { id: "base.en", label: "Base (English)", sizeBytes: 148_000_000, multilingual: false, recommended: false, downloaded: false, active: false },
    { id: "small.en", label: "Small (English)", sizeBytes: 488_000_000, multilingual: false, recommended: true, downloaded: true, active: true },
    { id: "small", label: "Small (Multilingual)", sizeBytes: 488_000_000, multilingual: true, recommended: false, downloaded: false, active: false },
    { id: "medium", label: "Medium (Multilingual)", sizeBytes: 1_530_000_000, multilingual: true, recommended: false, downloaded: false, active: false },
    { id: "large-v3-turbo", label: "Large v3 Turbo", sizeBytes: 1_620_000_000, multilingual: true, recommended: false, downloaded: false, active: false },
  ];
}

function seedTransforms(): Transform[] {
  return [
    { id: "tf_polish", name: "Polish", instruction: "Fix grammar and tighten the wording. Keep my voice.", shortcut: "Alt+Shift+1", builtin: true },
    { id: "tf_prompt", name: "Prompt engineer", instruction: "Rewrite this as a clear, well-structured prompt for an AI assistant.", shortcut: "Alt+Shift+2", builtin: true },
    { id: "tf_shorter", name: "Make it shorter", instruction: "Cut this to the essential points without changing the meaning.", builtin: false },
  ];
}

export interface MockBackend {
  invoke(cmd: string, args?: Args): Promise<unknown>;
  on<E extends EventName>(event: E, cb: (payload: EventMap[E]) => void): () => void;
}

export function createMockBackend(options: { pillDemo?: boolean } = {}): MockBackend {
  const now = Date.now();
  let settings = defaultSettings();
  let history = seedHistory(now);
  let models = seedModels();
  let transforms = seedTransforms();
  let apiKey: string | null = null;
  const dictionary: DictEntry[] = [
    { id: "d_1", word: "Kubernetes", heardAs: "cooper netties", auto: false },
    { id: "d_2", word: "Okafor", heardAs: "oh car for", auto: false },
    { id: "d_3", word: "Tauri", heardAs: "tory", auto: true },
    { id: "d_4", word: "Priya", auto: false },
    { id: "d_5", word: "PostgreSQL", heardAs: "post gress", auto: false },
    { id: "d_6", word: "Figma", auto: true },
  ];
  const snippets: Snippet[] = [
    { id: "s_1", trigger: "my linkedin", expansion: "https://www.linkedin.com/in/maya-lindqvist" },
    { id: "s_2", trigger: "my email", expansion: "maya@lindqvist.studio" },
    { id: "s_3", trigger: "my calendar link", expansion: "https://cal.com/maya/30min" },
  ];
  const notes: Note[] = [
    { id: "n_1", title: "Launch checklist", body: "Final copy from Priya by Thursday.\nRecord the 30 second demo.\nCheck the installer on ARM64.", updatedAt: now - 2 * 3_600_000 },
    { id: "n_2", title: "Ideas for the weekend", body: "Try a dictation-only writing session.\nTidy the dictionary: add product names.", updatedAt: now - 3 * DAY },
  ];

  const listeners = new Map<string, Set<Listener>>();
  const emit = <E extends EventName>(event: E, payload: EventMap[E]) => {
    listeners.get(event)?.forEach((cb) => (cb as (p: EventMap[E]) => void)(payload));
  };
  const on: MockBackend["on"] = (event, cb) => {
    let set = listeners.get(event);
    if (!set) listeners.set(event, (set = new Set()));
    set.add(cb as Listener);
    return () => set.delete(cb as Listener);
  };

  const downloads = new Map<string, ReturnType<typeof setInterval>>();

  function insights(): Insights {
    const heatmap = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
    const apps = new Map<string, number>();
    const cats = new Map<Category, number>();
    const days = new Set<string>();
    let total = 0;
    let week = 0;
    let ms = 0;
    for (const h of history) {
      const d = new Date(h.createdAt);
      heatmap[(d.getDay() + 6) % 7][d.getHours()] += h.words;
      apps.set(h.appName, (apps.get(h.appName) ?? 0) + h.words);
      cats.set(h.category, (cats.get(h.category) ?? 0) + h.words);
      days.add(d.toDateString());
      total += h.words;
      ms += h.durationMs;
      if (Date.now() - h.createdAt < 7 * DAY) week += h.words;
    }
    let current = 0;
    for (let i = 0; i < 400; i++) {
      if (days.has(new Date(Date.now() - i * DAY).toDateString())) current++;
      else if (i > 0) break;
    }
    let longest = 0;
    let run = 0;
    for (let i = 400; i >= 0; i--) {
      if (days.has(new Date(Date.now() - i * DAY).toDateString())) longest = Math.max(longest, ++run);
      else run = 0;
    }
    const avgWpm = ms > 0 ? Math.round(total / (ms / 60_000)) : 0;
    return {
      totalWords: total,
      weekWords: week,
      avgWpm,
      timeSavedMin: Math.max(0, Math.round(total / 40 - ms / 60_000)),
      currentStreak: current,
      longestStreak: longest,
      heatmap,
      topApps: [...apps.entries()].map(([name, words]) => ({ name, words })).sort((a, b) => b.words - a.words).slice(0, 5),
      categories: [...cats.entries()].map(([category, words]) => ({ category, words })).sort((a, b) => b.words - a.words),
    };
  }

  function usage(): Usage {
    const ai = history.filter((h) => h.usedAi).length;
    const input = ai * 420;
    const output = ai * 70;
    return { monthInputTokens: input, monthOutputTokens: output, estCostUsd: (input * 0.1 + output * 0.5) / 1_000_000 };
  }

  const text = (v: unknown) => String(v ?? "");

  async function invoke(cmd: string, a: Args = {}): Promise<unknown> {
    switch (cmd) {
      case "get_settings":
        return structuredClone(settings);
      case "update_settings": {
        settings = structuredClone(a.settings as Settings);
        emit("settings://changed", structuredClone(settings));
        return structuredClone(settings);
      }
      case "reset_shortcuts":
        settings = { ...settings, shortcuts: structuredClone(DEFAULT_SHORTCUTS) };
        emit("settings://changed", structuredClone(settings));
        return structuredClone(settings);
      case "api_key_status":
        return apiKey ? { set: true, last4: apiKey.slice(-4) } : { set: false };
      case "set_api_key":
        apiKey = text(a.key);
        return null;
      case "clear_api_key":
        apiKey = null;
        return null;
      case "test_api_key": {
        const k = a.key ? text(a.key) : apiKey;
        await new Promise((r) => setTimeout(r, 500));
        if (!k) throw "No API key set.";
        if (!k.startsWith("sk-ant-")) throw "That key was rejected. Check that you copied all of it.";
        return null;
      }
      case "list_models":
        return structuredClone(models);
      case "download_model": {
        const id = text(a.id);
        const total = models.find((m) => m.id === id)?.sizeBytes ?? 1e8;
        let downloaded = 0;
        clearInterval(downloads.get(id));
        const t = setInterval(() => {
          downloaded = Math.min(total, downloaded + total / 20);
          const done = downloaded >= total;
          const p: ModelProgress = { id, downloaded, total, done };
          if (done) {
            clearInterval(t);
            downloads.delete(id);
            models = models.map((m) => (m.id === id ? { ...m, downloaded: true } : m));
          }
          emit("model://progress", p);
        }, 150);
        downloads.set(id, t);
        return null;
      }
      case "cancel_download": {
        const t = downloads.get(text(a.id));
        if (t) clearInterval(t);
        downloads.delete(text(a.id));
        return null;
      }
      case "delete_model":
        models = models.map((m) => (m.id === a.id ? { ...m, downloaded: false, active: false } : m));
        return null;
      case "set_active_model":
        models = models.map((m) => ({ ...m, active: m.id === a.id }));
        settings = { ...settings, activeModel: text(a.id) };
        return null;
      case "list_microphones":
        return ["Microphone Array (Realtek Audio)", "Headset (WH-1000XM5 Hands-Free)", "USB Condenser Mic"];
      case "start_mic_test": {
        const t = setInterval(() => emit("mic://level", Math.max(0, Math.min(1, 0.35 + Math.sin(Date.now() / 180) * 0.3 + Math.random() * 0.2))), 80);
        downloads.set("__mic", t);
        return null;
      }
      case "stop_mic_test":
        clearInterval(downloads.get("__mic"));
        downloads.delete("__mic");
        return null;
      case "start_shortcut_capture":
      case "stop_shortcut_capture":
        return null;

      case "history_list": {
        const q = text(a.query).trim().toLowerCase();
        const limit = Number(a.limit ?? 50);
        const offset = Number(a.offset ?? 0);
        const rows = q
          ? history.filter((h) => `${h.finalText} ${h.rawText} ${h.appName}`.toLowerCase().includes(q))
          : history;
        return structuredClone(rows.slice(offset, offset + limit));
      }
      case "history_update_text": {
        const h = history.find((x) => x.id === a.id);
        if (!h) throw "Not found";
        const before = new Set(h.finalText.toLowerCase().split(/\W+/));
        h.finalText = text(a.text);
        emit("history://changed", undefined);
        return [...new Set(h.finalText.split(/\s+/).map((w) => w.replace(/[^\w'-]/g, "")))].filter(
          (w) => w.length > 3 && /^[A-Z]/.test(w) && !before.has(w.toLowerCase()),
        );
      }
      case "history_retry": {
        const h = history.find((x) => x.id === a.id);
        if (!h) throw "Not found";
        h.error = undefined;
        h.usedAi = true;
        emit("history://changed", undefined);
        return structuredClone(h);
      }
      case "history_insert":
      case "history_copy":
        return null;
      case "history_audio_path":
        return null;
      case "history_delete":
        history = history.filter((h) => h.id !== a.id);
        emit("history://changed", undefined);
        return null;
      case "history_clear":
        history = [];
        emit("history://changed", undefined);
        return null;

      case "dictionary_list":
        return structuredClone(dictionary);
      case "dictionary_add": {
        const word = text(a.word).trim().slice(0, 60);
        const e: DictEntry = { id: nextId("d"), word, heardAs: a.heardAs ? text(a.heardAs) : undefined, auto: false };
        dictionary.unshift(e);
        return structuredClone(e);
      }
      case "dictionary_update": {
        const e = a.entry as DictEntry;
        const i = dictionary.findIndex((d) => d.id === e.id);
        if (i >= 0) dictionary[i] = { ...e };
        return structuredClone(e);
      }
      case "dictionary_delete":
        dictionary.splice(0, dictionary.length, ...dictionary.filter((d) => d.id !== a.id));
        return null;
      case "dictionary_import_csv": {
        const lines = text(a.text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        let n = 0;
        for (const line of lines) {
          const [word, heard] = line.split(",").map((s) => s.trim());
          if (!word || word.toLowerCase() === "word") continue;
          dictionary.push({ id: nextId("d"), word, heardAs: heard || undefined, auto: false });
          n++;
        }
        return n;
      }
      case "dictionary_export_csv":
        return ["word,heardAs", ...dictionary.map((d) => `${d.word},${d.heardAs ?? ""}`)].join("\n");

      case "snippets_list":
        return structuredClone(snippets);
      case "snippets_add": {
        const s: Snippet = { id: nextId("s"), trigger: text(a.trigger).slice(0, 60), expansion: text(a.expansion).slice(0, 4000) };
        snippets.unshift(s);
        return structuredClone(s);
      }
      case "snippets_update": {
        const s = a.snippet as Snippet;
        const i = snippets.findIndex((x) => x.id === s.id);
        if (i >= 0) snippets[i] = { ...s };
        return structuredClone(s);
      }
      case "snippets_delete":
        snippets.splice(0, snippets.length, ...snippets.filter((s) => s.id !== a.id));
        return null;
      case "snippets_import_csv": {
        const lines = text(a.text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        let n = 0;
        for (const line of lines) {
          const idx = line.indexOf(",");
          if (idx < 1) continue;
          const trigger = line.slice(0, idx).trim();
          if (trigger.toLowerCase() === "trigger") continue;
          snippets.push({ id: nextId("s"), trigger, expansion: line.slice(idx + 1).trim() });
          n++;
        }
        return n;
      }
      case "snippets_export_csv":
        return ["trigger,expansion", ...snippets.map((s) => `${s.trigger},${s.expansion}`)].join("\n");

      case "transforms_list":
        return structuredClone(transforms);
      case "transforms_add": {
        if (transforms.filter((t) => !t.builtin).length >= 8) throw "You can add up to 8 custom transforms.";
        const t: Transform = {
          id: nextId("tf"),
          name: text(a.name),
          instruction: text(a.instruction),
          shortcut: a.shortcut ? text(a.shortcut) : undefined,
          builtin: false,
        };
        transforms.push(t);
        return structuredClone(t);
      }
      case "transforms_update": {
        const t = a.transform as Transform;
        transforms = transforms.map((x) => (x.id === t.id ? { ...t } : x));
        return structuredClone(t);
      }
      case "transforms_delete":
        transforms = transforms.filter((t) => t.id !== a.id || t.builtin);
        return null;

      case "notes_list":
        return structuredClone([...notes].sort((x, y) => y.updatedAt - x.updatedAt));
      case "notes_create": {
        const n: Note = { id: nextId("n"), title: "Untitled note", body: "", updatedAt: Date.now() };
        notes.unshift(n);
        return structuredClone(n);
      }
      case "notes_update": {
        const n = a.note as Note;
        const i = notes.findIndex((x) => x.id === n.id);
        if (i >= 0) notes[i] = { ...n, updatedAt: Date.now() };
        return structuredClone(notes[i]);
      }
      case "notes_delete":
        notes.splice(0, notes.length, ...notes.filter((n) => n.id !== a.id));
        return null;

      case "insights_get":
        return insights();
      case "usage_get":
        return usage();
      case "pill_action":
        if (a.action === "openHub") emit("hub://navigate", { page: "home" });
        return null;
      case "complete_onboarding":
        settings = { ...settings, onboarded: true };
        emit("settings://changed", structuredClone(settings));
        return null;
      case "app_info":
        return { version: "0.1.0" };
      default:
        throw `Unknown command: ${cmd}`;
    }
  }

  if (options.pillDemo) startPillDemo(emit);

  return { invoke, on };
}

function startPillDemo(emit: <E extends EventName>(e: E, p: EventMap[E]) => void) {
  const script: { state: PillState["state"]; mode: string; ms: number; message?: string }[] = [
    { state: "idle", mode: "dictate", ms: 1800 },
    { state: "listening", mode: "dictate", ms: 4000 },
    { state: "thinking", mode: "dictate", ms: 1400 },
    { state: "done", mode: "dictate", ms: 1400, message: "Inserted 24 words" },
    { state: "listening", mode: "dictateEnhance", ms: 3200 },
    { state: "locked", mode: "handsFree", ms: 3200 },
    { state: "thinking", mode: "command", ms: 1400 },
    { state: "error", mode: "command", ms: 2400, message: "Add an API key to use commands" },
  ];
  let step = 0;
  let elapsed = 0;
  let stepStart = Date.now();
  const tick = setInterval(() => {
    const cur = script[step];
    elapsed = Date.now() - stepStart;
    emit("pill://state", { state: cur.state, mode: cur.mode, elapsedMs: elapsed, message: cur.message });
    if (cur.state === "listening" || cur.state === "locked") {
      const t = Date.now() / 220;
      emit("pill://levels", Array.from({ length: 12 }, (_, i) => Math.max(0.05, Math.min(1, 0.45 + Math.sin(t + i * 0.7) * 0.3 + Math.sin(t * 2.3 + i) * 0.15))));
    }
    if (elapsed >= cur.ms) {
      step = (step + 1) % script.length;
      stepStart = Date.now();
    }
  }, 80);
  return () => clearInterval(tick);
}

