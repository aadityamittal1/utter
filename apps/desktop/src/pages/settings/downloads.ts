// Module-level download tracker. It outlives the Models tab, so leaving and
// returning mid-download still shows progress (and never offers Download twice).
import { useSyncExternalStore } from "react";
import { on } from "../../lib/ipc";
import type { ModelProgress } from "../../lib/types";

export interface DownloadsState {
  progress: Record<string, ModelProgress>;
  errors: Record<string, string>;
  /** Bumped whenever a download finishes, so views can refresh the model list. */
  doneTick: number;
}

let state: DownloadsState = { progress: {}, errors: {}, doneTick: 0 };
const subs = new Set<() => void>();
/** Downloads the user cancelled: later events for them are ignored until a new download starts. */
const cancelled = new Set<string>();
let listening = false;

const set = (next: Partial<DownloadsState>) => {
  state = { ...state, ...next };
  subs.forEach((f) => f());
};

function without<T>(rec: Record<string, T>, key: string): Record<string, T> {
  const n = { ...rec };
  delete n[key];
  return n;
}

export function handleProgress(p: ModelProgress): void {
  if (cancelled.has(p.id)) return;
  if (p.error) {
    set({ progress: without(state.progress, p.id), errors: { ...state.errors, [p.id]: p.error } });
  } else if (p.done) {
    set({ progress: without(state.progress, p.id), doneTick: state.doneTick + 1 });
  } else {
    set({ progress: { ...state.progress, [p.id]: p } });
  }
}

function ensureListening(): void {
  if (listening) return;
  listening = true;
  on("model://progress", handleProgress).catch(() => {
    listening = false;
  });
}

export function beginDownload(id: string): void {
  cancelled.delete(id);
  set({ progress: { ...state.progress, [id]: { id, downloaded: 0, total: 0, done: false } }, errors: without(state.errors, id) });
}

export function markCancelled(id: string): void {
  cancelled.add(id);
  set({ progress: without(state.progress, id) });
}

export function failDownload(id: string, message: string): void {
  set({ progress: without(state.progress, id), errors: { ...state.errors, [id]: message } });
}

export function clearDownloadError(id: string): void {
  set({ errors: without(state.errors, id) });
}

/** Test helper. */
export function resetDownloads(): void {
  cancelled.clear();
  state = { progress: {}, errors: {}, doneTick: 0 };
  subs.forEach((f) => f());
}

export function getDownloads(): DownloadsState {
  return state;
}

function subscribe(cb: () => void): () => void {
  ensureListening();
  subs.add(cb);
  return () => subs.delete(cb);
}

export function useDownloads(): DownloadsState {
  return useSyncExternalStore(subscribe, getDownloads);
}
