import { convertFileSrc } from "@tauri-apps/api/core";
import { isTauri } from "../../../lib/ipc";

// One player for the whole page: starting a clip stops the previous one.
let stopCurrent: (() => void) | null = null;

/**
 * Play a clip. Returns a stop function (safe to call repeatedly) that pauses and
 * releases the audio. `onStop` fires exactly once when the clip ends, fails or is
 * stopped; `onError` fires at most once, only on load/play failure.
 */
export function playClip(path: string, onStop: () => void, onError: () => void): () => void {
  stopCurrent?.();
  const audio = new Audio(isTauri() ? convertFileSrc(path) : path);
  let done = false;
  const stop = () => {
    if (done) return;
    done = true;
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    if (stopCurrent === stop) stopCurrent = null;
    onStop();
  };
  const fail = () => {
    if (done) return;
    stop();
    onError();
  };
  stopCurrent = stop;
  audio.onended = stop;
  audio.onerror = fail;
  audio.play().catch(fail);
  return stop;
}
