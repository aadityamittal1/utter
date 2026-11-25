// Typed IPC layer. Uses Tauri when running inside the app, otherwise an
// in-memory mock backend so the UI can be developed in a plain browser.

import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createMockBackend, type MockBackend } from "./mock";
import type {
  ApiKeyStatus,
  DictEntry,
  EventMap,
  EventName,
  HistoryItem,
  Insights,
  ModelStatus,
  Note,
  PillAction,
  Settings,
  Snippet,
  Transform,
  Usage,
} from "./types";

export const isTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let mock: MockBackend | null = null;
function getMock(): MockBackend {
  if (!mock) {
    const pillDemo = typeof location !== "undefined" && new URLSearchParams(location.search).has("pill-demo");
    mock = createMockBackend({ pillDemo });
  }
  return mock;
}

function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri()) return tauriInvoke<T>(cmd, args);
  return getMock().invoke(cmd, args) as Promise<T>;
}

/** Subscribe to a backend event. Resolves to an unlisten function. */
export async function on<E extends EventName>(event: E, cb: (payload: EventMap[E]) => void): Promise<() => void> {
  if (isTauri()) {
    return listen<EventMap[E]>(event, (e) => cb(e.payload));
  }
  return getMock().on(event, cb);
}

export const ipc = {
  // settings
  getSettings: () => call<Settings>("get_settings"),
  updateSettings: (settings: Settings) => call<Settings>("update_settings", { settings }),
  resetShortcuts: () => call<Settings>("reset_shortcuts"),
  completeOnboarding: () => call<void>("complete_onboarding"),
  appInfo: () => call<{ version: string }>("app_info"),

  // api key
  apiKeyStatus: () => call<ApiKeyStatus>("api_key_status"),
  setApiKey: (key: string) => call<void>("set_api_key", { key }),
  clearApiKey: () => call<void>("clear_api_key"),
  /** Rejects with a user-readable string when the key is invalid. */
  testApiKey: (key?: string) => call<void>("test_api_key", { key }),

  // models + audio
  listModels: () => call<ModelStatus[]>("list_models"),
  downloadModel: (id: string) => call<void>("download_model", { id }),
  cancelDownload: (id: string) => call<void>("cancel_download", { id }),
  deleteModel: (id: string) => call<void>("delete_model", { id }),
  setActiveModel: (id: string) => call<void>("set_active_model", { id }),
  listMicrophones: () => call<string[]>("list_microphones"),
  startMicTest: () => call<void>("start_mic_test"),
  stopMicTest: () => call<void>("stop_mic_test"),
  startShortcutCapture: () => call<void>("start_shortcut_capture"),
  stopShortcutCapture: () => call<void>("stop_shortcut_capture"),

  // history
  historyList: (query: string | undefined, limit: number, offset: number) =>
    call<HistoryItem[]>("history_list", { query, limit, offset }),
  /** Returns words the user may want to add to the dictionary. */
  historyUpdateText: (id: string, text: string) => call<string[]>("history_update_text", { id, text }),
  historyRetry: (id: string) => call<HistoryItem>("history_retry", { id }),
  historyInsert: (id: string) => call<void>("history_insert", { id }),
  historyCopy: (id: string) => call<void>("history_copy", { id }),
  historyAudioPath: (id: string) => call<string | null>("history_audio_path", { id }),
  historyDelete: (id: string) => call<void>("history_delete", { id }),
  historyClear: () => call<void>("history_clear"),

  // dictionary
  dictionaryList: () => call<DictEntry[]>("dictionary_list"),
  dictionaryAdd: (word: string, heardAs?: string) => call<DictEntry>("dictionary_add", { word, heardAs }),
  dictionaryUpdate: (entry: DictEntry) => call<DictEntry>("dictionary_update", { entry }),
  dictionaryDelete: (id: string) => call<void>("dictionary_delete", { id }),
  dictionaryImportCsv: (text: string) => call<number>("dictionary_import_csv", { text }),
  dictionaryExportCsv: () => call<string>("dictionary_export_csv"),

  // snippets
  snippetsList: () => call<Snippet[]>("snippets_list"),
  snippetsAdd: (trigger: string, expansion: string) => call<Snippet>("snippets_add", { trigger, expansion }),
  snippetsUpdate: (snippet: Snippet) => call<Snippet>("snippets_update", { snippet }),
  snippetsDelete: (id: string) => call<void>("snippets_delete", { id }),
  snippetsImportCsv: (text: string) => call<number>("snippets_import_csv", { text }),
  snippetsExportCsv: () => call<string>("snippets_export_csv"),

  // transforms
  transformsList: () => call<Transform[]>("transforms_list"),
  transformsAdd: (name: string, instruction: string, shortcut?: string) =>
    call<Transform>("transforms_add", { name, instruction, shortcut }),
  transformsUpdate: (transform: Transform) => call<Transform>("transforms_update", { transform }),
  transformsDelete: (id: string) => call<void>("transforms_delete", { id }),

  // notes
  notesList: () => call<Note[]>("notes_list"),
  notesCreate: () => call<Note>("notes_create"),
  notesUpdate: (note: Note) => call<Note>("notes_update", { note }),
  notesDelete: (id: string) => call<void>("notes_delete", { id }),

  // stats
  insightsGet: () => call<Insights>("insights_get"),
  usageGet: () => call<Usage>("usage_get"),

  // pill
  pillAction: (action: PillAction) => call<void>("pill_action", { action }),
};

export type Ipc = typeof ipc;
