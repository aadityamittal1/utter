import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { ipc } from "../lib/ipc";
import type { PillAction, PillState } from "../lib/types";
import { useBackendEvent } from "../lib/useBackendEvent";
import { Bars, ThinkingDots } from "./Bars";
import {
  BAR_COUNT,
  DONE_VISIBLE_MS,
  ariaLabel,
  capsuleSize,
  formatRemaining,
  formatTimer,
  isWarning,
  showTimer,
  smoothLevels,
  viewFor,
} from "./pillLogic";
import "./pill.css";

const ZERO = new Array<number>(BAR_COUNT).fill(0);
const MENU_IDLE_CLOSE_MS = 5000;
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
  levels: readonly number[];
  menuOpen?: boolean;
  reduced?: boolean;
  onAction?: (a: PillAction, label?: string) => void;
  onMenu?: (open: boolean) => void;
}

/** Presentational pill. All state comes in through props, so a harness can drive it. */
export function PillView({ state, levels, menuOpen = false, reduced = false, onAction, onMenu }: PillViewProps) {
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
        <div className="pill-menu" role="menu" aria-label="Pill options" key="menu">
          <button className="pill-menu-item" role="menuitem" autoFocus onClick={() => { act("hide1h")(); onMenu?.(false); }}>
            Hide for 1 hour
          </button>
          <span className="pill-menu-sep" aria-hidden="true" />
          <button className="pill-menu-item" role="menuitem" onClick={() => { act("openHub")(); onMenu?.(false); }}>
            Open Utter
          </button>
          <span className="pill-menu-sep" aria-hidden="true" />
          {/* No dedicated settings action in the pill IPC contract yet: opens the hub. */}
          <button className="pill-menu-item" role="menuitem" onClick={() => { act("openHub")(); onMenu?.(false); }}>
            Settings
          </button>
        </div>
      ) : (
        <div className="pill-content" key={view}>
          {(view === "listening" || view === "warning" || view === "locked") && (
            <>
              <span className="pill-dot" data-lock={state.state === "locked"} aria-hidden="true" />
              <Bars levels={levels} reduced={reduced} />
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
              <button className="pill-chip" onClick={act("retry")}>
                Retry
              </button>
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
  const [levels, setLevels] = useState<number[]>(ZERO);
  const [menuOpen, setMenuOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [episode, setEpisode] = useState(0);
  const [doneExpired, setDoneExpired] = useState(-1);
  const target = useRef<number[]>(ZERO);
  const prevKind = useRef(IDLE.state);

  useBackendEvent("pill://state", (next) => {
    if (next.state !== prevKind.current) {
      if (next.state === "done") setEpisode((n) => n + 1);
      if (next.state === "listening" || next.state === "locked") setMenuOpen(false);
      prevKind.current = next.state;
    }
    setState(next);
  });
  useBackendEvent("pill://levels", (l) => {
    target.current = l;
  });

  // "Inserted" shows for 900 ms, then the capsule folds back to idle.
  useEffect(() => {
    if (episode === 0) return;
    const t = setTimeout(() => setDoneExpired(episode), DONE_VISIBLE_MS);
    return () => clearTimeout(t);
  }, [episode]);

  const live = state.state === "listening" || state.state === "locked";

  // Ease the displayed levels toward the latest reading. Bars fall when data stops.
  useEffect(() => {
    if (!live || reduced) return;
    target.current = ZERO;
    let shown = ZERO;
    const id = setInterval(() => {
      shown = smoothLevels(shown, target.current);
      setLevels(shown);
    }, 40);
    return () => {
      clearInterval(id);
      setLevels(ZERO);
    };
  }, [live, reduced]);

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
  }, [menuOpen]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), FLASH_MS);
    return () => clearTimeout(t);
  }, [flash]);

  const onAction = useCallback((a: PillAction) => {
    ipc.pillAction(a).catch((e: unknown) => setFlash(typeof e === "string" ? e : "Couldn't do that"));
  }, []);

  let shownState = state;
  if (state.state === "done" && doneExpired === episode) shownState = IDLE;
  if (flash) shownState = { state: "error", mode: state.mode, elapsedMs: 0, message: flash };

  return (
    <div
      className="pill-root"
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuOpen(true);
      }}
      onPointerDown={() => setMenuOpen(false)}
    >
      <PillView state={shownState} levels={levels} menuOpen={menuOpen} reduced={reduced} onAction={onAction} onMenu={setMenuOpen} />
      <div className="sr-only" role="status" aria-live="polite">
        {ariaLabel(shownState)}
      </div>
    </div>
  );
}
