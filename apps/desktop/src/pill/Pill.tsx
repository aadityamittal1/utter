import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { ipc } from "../lib/ipc";
import type { PillAction, PillState } from "../lib/types";
import { useBackendEvent } from "../lib/useBackendEvent";
import { Bars, ThinkingDots } from "./Bars";
import {
  BAR_COUNT,
  DONE_VISIBLE_MS,
  ariaLabel,
  capsuleSize,
  effectiveElapsed,
  formatRemaining,
  formatTimer,
  isWarning,
  showTimer,
  viewFor,
} from "./pillLogic";
import "./pill.css";

const ZERO = new Array<number>(BAR_COUNT).fill(0);
const MENU_IDLE_CLOSE_MS = 3000;
const CLOCK_TICK_MS = 250;
const FLASH_MS = 2600;
const IDLE: PillState = { state: "idle", mode: "dictate", elapsedMs: 0 };

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

export interface PillViewProps {
  state: PillState;
  levelsRef: RefObject<readonly number[]>;
  menuOpen?: boolean;
  reduced?: boolean;
  onAction?: (a: PillAction, label?: string) => void;
  onMenu?: (open: boolean) => void;
  /** Pointer activity inside the open menu: keeps it from auto-closing. */
  onMenuActivity?: () => void;
}

/** Presentational pill. All state comes in through props, so a harness can drive it. */
export function PillView({ state, levelsRef, menuOpen = false, reduced = false, onAction, onMenu, onMenuActivity }: PillViewProps) {
  const view = viewFor(state, menuOpen);
  const size = capsuleSize(view, state.message);
  const act = (a: PillAction) => () => onAction?.(a);
  const style = { "--w": `${size.w}px`, "--h": `${size.h}px` } as CSSProperties;
  const live = state.state === "listening" || state.state === "locked";
  const warn = live && isWarning(state.elapsedMs);

  return (
    <div
      className="pill-capsule"
      data-view={view}
      style={style}
      role="group"
      aria-label="Utter dictation"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {view === "menu" ? (
        <div className="pill-menu" role="menu" aria-label="Pill options" key="menu" onPointerMove={onMenuActivity} onPointerDown={onMenuActivity}>
          <button className="pill-menu-item" role="menuitem" autoFocus onClick={() => { act("hide1h")(); onMenu?.(false); }}>
            Hide for 1 hour
          </button>
          <span className="pill-menu-sep" aria-hidden="true" />
          <button className="pill-menu-item" role="menuitem" onClick={() => { act("openHub")(); onMenu?.(false); }}>
            Open Utter
          </button>
          <span className="pill-menu-sep" aria-hidden="true" />
          <button className="pill-menu-item" role="menuitem" onClick={() => { act("openSettings")(); onMenu?.(false); }}>
            Settings
          </button>
          <button className="pill-menu-close" role="menuitem" onClick={() => onMenu?.(false)} aria-label="Close menu" title="Close">
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ) : (
        <div className="pill-content" key={view}>
          {(view === "listening" || view === "warning" || view === "locked") && (
            <>
              <span className="pill-dot" data-lock={state.state === "locked"} aria-hidden="true" />
              <Bars levelsRef={levelsRef} reduced={reduced} />
              {warn ? (
                <span className="pill-warn" title="Recording stops at 20 minutes">
                  {formatRemaining(state.elapsedMs)}
                </span>
              ) : (
                <span className="pill-timer" data-show={showTimer(state.elapsedMs)} aria-hidden={!showTimer(state.elapsedMs)}>
                  {formatTimer(state.elapsedMs)}
                </span>
              )}
              {view === "locked" && (
                <>
                  <button className="pill-btn" data-tone="stop" onClick={act("stop")} aria-label="Stop and insert" title="Stop">
                    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                      <rect x="1" y="1" width="8" height="8" rx="1.5" fill="currentColor" />
                    </svg>
                  </button>
                  <button className="pill-btn" data-tone="muted" onClick={act("cancel")} aria-label="Cancel" title="Cancel">
                    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                      <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                  </button>
                </>
              )}
            </>
          )}

          {view === "thinking" && <ThinkingDots />}

          {view === "done" && (
            <>
              <svg className="pill-check" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M2.5 7.5l3 3 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="pill-text">{state.message ?? "Inserted"}</span>
            </>
          )}

          {view === "error" && (
            <>
              <span className="pill-text" title={state.message}>
                {state.message ?? "Something went wrong"}
              </span>
              {state.retryable === true && (
                <button className="pill-chip" onClick={act("retry")}>
                  Retry
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Container: wires backend events and actions to the presentational pill. */
export function Pill() {
  const reduced = usePrefersReducedMotion();
  const [state, setState] = useState<PillState>(IDLE);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuActivity, setMenuActivity] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  const [episode, setEpisode] = useState(0);
  const [doneExpired, setDoneExpired] = useState(-1);
  const [localMs, setLocalMs] = useState(0);
  const levelsRef = useRef<readonly number[]>(ZERO);
  const prevKind = useRef(IDLE.state);
  const prevDoneMsg = useRef<string | undefined>(undefined);
  const clockStart = useRef<number | null>(null);

  useBackendEvent("pill://state", (next) => {
    const prev = prevKind.current;
    const wasLive = prev === "listening" || prev === "locked";
    const isLive = next.state === "listening" || next.state === "locked";
    if (next.state !== prev) {
      setMenuOpen(false); // any state change dismisses the menu
      if (isLive && !wasLive) {
        levelsRef.current = ZERO;
        clockStart.current = performance.now() - next.elapsedMs; // anchored at the first listening event
      }
      if (!isLive) clockStart.current = null;
      prevKind.current = next.state;
    }
    // A second "done" (new episode, or same kind with a new message) restarts the 900 ms fold.
    if (next.state === "done" && (prev !== "done" || next.message !== prevDoneMsg.current)) {
      setEpisode((n) => n + 1);
    }
    prevDoneMsg.current = next.state === "done" ? next.message : undefined;
    setState(next);
  });
  useBackendEvent("pill://levels", (l) => {
    levelsRef.current = l;
  });

  // "Inserted" shows for 900 ms, then the capsule folds back to idle.
  useEffect(() => {
    if (episode === 0) return;
    const t = setTimeout(() => setDoneExpired(episode), DONE_VISIBLE_MS);
    return () => clearTimeout(t);
  }, [episode]);

  const live = state.state === "listening" || state.state === "locked";

  // Local clock so a sparse backend cadence cannot freeze the timer.
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => {
      if (clockStart.current !== null) setLocalMs(performance.now() - clockStart.current);
    }, CLOCK_TICK_MS);
    return () => {
      clearInterval(id);
      setLocalMs(0);
    };
  }, [live]);

  // Menu: auto-closes after 3 s without pointer activity; Esc / blur also close it.
  useEffect(() => {
    if (!menuOpen) return;
    const t = setTimeout(() => setMenuOpen(false), MENU_IDLE_CLOSE_MS);
    const close = () => setMenuOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", key);
    window.addEventListener("blur", close);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", close);
    };
  }, [menuOpen, menuActivity]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), FLASH_MS);
    return () => clearTimeout(t);
  }, [flash]);

  const onAction = useCallback((a: PillAction) => {
    ipc.pillAction(a).catch((e: unknown) => setFlash(typeof e === "string" ? e : "Couldn't do that"));
  }, []);
  const bumpMenu = useCallback(() => setMenuActivity((n) => n + 1), []);

  let shownState = state;
  if (live) shownState = { ...state, elapsedMs: effectiveElapsed(state.elapsedMs, localMs) };
  if (state.state === "done" && doneExpired === episode) shownState = IDLE;
  // A flash must never cover live controls (stop / cancel).
  if (flash && !live) shownState = { state: "error", mode: state.mode, elapsedMs: 0, message: flash };

  return (
    <div
      className="pill-root"
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuOpen(true);
      }}
      onPointerDown={() => setMenuOpen(false)}
    >
      <PillView
        state={shownState}
        levelsRef={levelsRef}
        menuOpen={menuOpen}
        reduced={reduced}
        onAction={onAction}
        onMenu={setMenuOpen}
        onMenuActivity={bumpMenu}
      />
      <div className="sr-only" role="status" aria-live="polite">
        {ariaLabel(shownState)}
      </div>
    </div>
  );
}
