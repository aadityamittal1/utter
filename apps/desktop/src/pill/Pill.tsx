import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type RefObject } from "react";
import { ipc } from "../lib/ipc";
import type { PillAction, PillState } from "../lib/types";
import { useBackendEvent } from "../lib/useBackendEvent";
import { Bars, ThinkingDots } from "./Bars";
import {
  BAR_COUNT,
  CAPSULE_BOTTOM_MARGIN,
  ariaLabel,
  capsuleSize,
  clickAction,
  effectiveElapsed,
  formatRemaining,
  formatTimer,
  hoverKeys,
  isWarning,
  menuAllowed,
  showTimer,
  viewFor,
} from "./pillLogic";
import "./pill.css";

const ZERO = new Array<number>(BAR_COUNT).fill(0);
const MENU_IDLE_CLOSE_MS = 3000;
const CLOCK_TICK_MS = 250;
const FLASH_MS = 2600;
/** Body clicks right after a view change are ignored (a double-click must not start then stop). */
const CLICK_GUARD_MS = 300;
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

/**
 * Tells Rust the menu is open for exactly as long as `open` is true. Every way the menu can
 * close (item, Esc, blur, idle timeout, state change) flips `open`, and unmount runs the same
 * cleanup, so `menuClose` is sent on every path and the hit rect can never stay latched.
 */
export function useMenuLatch(open: boolean, send: (a: PillAction) => void): void {
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });
  useEffect(() => {
    if (!open) return;
    sendRef.current("menuOpen");
    return () => sendRef.current("menuClose");
  }, [open]);
}

const CloseIcon = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
    <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

export interface PillViewProps {
  state: PillState;
  levelsRef: RefObject<readonly number[]>;
  menuOpen?: boolean;
  /** Cursor is over the idle capsule (`pill://hover`). */
  hover?: boolean;
  /** The dictate chord, e.g. "Ctrl+Win", shown as keycaps in the hover capsule. */
  chord?: string;
  reduced?: boolean;
  onAction?: (a: PillAction) => void;
  onMenu?: (open: boolean) => void;
  /** Pointer activity inside the open menu: keeps it from auto-closing. */
  onMenuActivity?: () => void;
}

/** Presentational pill. All state comes in through props, so a harness can drive it. */
export function PillView({ state, levelsRef, menuOpen = false, hover = false, chord, reduced = false, onAction, onMenu, onMenuActivity }: PillViewProps) {
  const view = viewFor(state, menuOpen, hover);
  const size = capsuleSize(view);
  // Grow decelerates, shrink accelerates (Fluent enter / exit curves).
  const [sized, setSized] = useState<{ w: number; dir: "grow" | "shrink" }>({ w: size.w, dir: "grow" });
  if (sized.w !== size.w) setSized({ w: size.w, dir: size.w > sized.w ? "grow" : "shrink" });
  const act = (a: PillAction) => () => onAction?.(a);
  /** Inner buttons handle their own click; it must not also reach the capsule's click. */
  const own = (a: PillAction) => (e: MouseEvent) => {
    e.stopPropagation();
    onAction?.(a);
  };
  const style = { "--w": `${size.w}px`, "--h": `${size.h}px` } as CSSProperties;
  const live = state.state === "listening" || state.state === "locked";
  const warn = live && isWarning(state.elapsedMs);
  const click = clickAction(view);
  // Only idle / hover / listening are keyboard buttons. Locked has its own stop and cancel
  // buttons, so its body is a mouse-only click target.
  const isButton = click !== null && view !== "locked";

  // Hover capsule: keycaps if the chord fits next to "to dictate", else "Click to dictate".
  const keys = hoverKeys(chord);
  const hoverRef = useRef<HTMLDivElement>(null);
  const [tooWide, setTooWide] = useState<string | undefined>(undefined);
  useLayoutEffect(() => {
    const el = hoverRef.current;
    if (view !== "hover" || !keys || !el) return;
    // Natural width, measured independent of the animating capsule.
    const prev = el.style.width;
    el.style.width = "max-content";
    const natural = el.getBoundingClientRect().width;
    el.style.width = prev;
    if (natural > size.w - 2) setTooWide(chord);
  }, [view, keys, chord, size.w]);
  const shownKeys = keys && tooWide !== chord ? keys : null;

  // Ignore double-clicks and clicks right after the state changes.
  const guardKey = view === "hover" ? "idle" : view === "warning" ? "listening" : view;
  const seenView = useRef(guardKey);
  const changedAt = useRef(Number.NEGATIVE_INFINITY);
  useEffect(() => {
    if (seenView.current !== guardKey) {
      seenView.current = guardKey;
      changedAt.current = performance.now();
    }
  }, [guardKey]);
  const onBodyClick = (e: MouseEvent) => {
    if (click === null || e.detail > 1) return;
    if (performance.now() - changedAt.current < CLICK_GUARD_MS) return;
    onAction?.(click);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!isButton || click === null || e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onAction?.(click);
    }
  };

  return (
    <div
      className="pill-capsule"
      data-view={view}
      data-reduced={reduced}
      data-dir={sized.dir}
      style={style}
      role={isButton ? "button" : "group"}
      tabIndex={isButton ? 0 : undefined}
      aria-label={click === "start" ? "Start dictating" : click === "toggle" ? "Stop and insert" : "Utter dictation"}
      onClick={click ? onBodyClick : undefined}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {view === "menu" ? (
        <div className="pill-menu" role="menu" aria-label="Pill options" key="menu" onPointerMove={onMenuActivity} onPointerDown={onMenuActivity}>
          <button className="pill-menu-item" role="menuitem" onClick={() => { act("hide1h")(); onMenu?.(false); }}>
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
            <CloseIcon />
          </button>
        </div>
      ) : (
        <div className="pill-content" key={view === "listening" || view === "warning" || view === "locked" ? "live" : view} ref={view === "hover" ? hoverRef : undefined}>
          {view === "hover" &&
            (shownKeys ? (
              <>
                <span className="pill-keys">
                  {shownKeys.map((k, i) => (
                    <kbd key={`${k}-${i}`} className="pill-key" aria-hidden="true">
                      {k}
                    </kbd>
                  ))}
                  <span className="sr-only">{shownKeys.join(" plus ")}</span>
                </span>
                <span className="pill-text">to dictate</span>
              </>
            ) : (
              <span className="pill-text">Click to dictate</span>
            ))}

          {(view === "listening" || view === "warning" || view === "locked") && (
            <>
              <span className="pill-dot" aria-hidden="true" />
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
                  <button className="pill-btn" data-tone="stop" onClick={own("stop")} aria-label="Stop and insert" title="Stop">
                    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                      <rect x="1" y="1" width="8" height="8" rx="1.5" fill="currentColor" />
                    </svg>
                  </button>
                  <button className="pill-btn" data-tone="muted" onClick={own("cancel")} aria-label="Cancel" title="Cancel">
                    <CloseIcon />
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
              <span className="pill-text" title={state.message}>
                {state.message ?? "Inserted"}
              </span>
            </>
          )}

          {view === "error" && (
            <>
              <span className="pill-text" title={state.message}>
                {state.message ?? "Something went wrong"}
              </span>
              {state.retryable === true && (
                <button className="pill-chip" onClick={own("retry")}>
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
  const [hover, setHover] = useState(false);
  const [chord, setChord] = useState<string | undefined>(undefined);
  const [flash, setFlash] = useState<string | null>(null);
  const [localMs, setLocalMs] = useState(0);
  const levelsRef = useRef<readonly number[]>(ZERO);
  const prevKind = useRef(IDLE.state);
  const menuPinged = useRef(false);
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
    setState(next);
  });
  useBackendEvent("pill://levels", (l) => {
    levelsRef.current = l;
  });
  useBackendEvent("pill://hover", (h) => setHover(h.hover));
  useBackendEvent("settings://changed", (s) => setChord(s.shortcuts.dictate?.[0]));

  useEffect(() => {
    ipc
      .getSettings()
      .then((s) => setChord(s.shortcuts.dictate?.[0]))
      .catch(() => undefined); // no chord: the hover capsule says "Click to dictate"
  }, []);

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

  const onAction = useCallback((a: PillAction) => {
    ipc.pillAction(a).catch((e: unknown) => setFlash(typeof e === "string" ? e : "Couldn't do that"));
  }, []);
  // Latch bookkeeping must never surface as an error flash.
  const sendLatch = useCallback((a: PillAction) => {
    ipc.pillAction(a).catch(() => undefined);
  }, []);
  useMenuLatch(menuOpen, sendLatch);

  // Menu: auto-closes after 3 s without pointer activity; Esc / blur also close it.
  useEffect(() => {
    if (!menuOpen) return;
    const t = setTimeout(() => setMenuOpen(false), MENU_IDLE_CLOSE_MS);
    const close = () => setMenuOpen(false);
    const key = (e: globalThis.KeyboardEvent) => e.key === "Escape" && close();
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

  // The window is non-activating, so Esc and blur never reach the real pill: the 3 s idle timeout
  // (and Rust's own latch expiry) are what close a forgotten menu there. Re-send menuOpen on the
  // first pointer activity inside the open menu in case a close/open pair was reordered in flight.
  useEffect(() => {
    menuPinged.current = false;
  }, [menuOpen]);
  const bumpMenu = useCallback(() => {
    setMenuActivity((n) => n + 1);
    if (!menuPinged.current) {
      menuPinged.current = true;
      sendLatch("menuOpen");
    }
  }, [sendLatch]);

  let shownState = state;
  if (live) shownState = { ...state, elapsedMs: effectiveElapsed(state.elapsedMs, localMs) };
  // A flash must never cover live controls (stop / cancel).
  if (flash && !live) shownState = { state: "error", mode: state.mode, elapsedMs: 0, message: flash };

  return (
    <div
      className="pill-root"
      style={{ paddingBottom: CAPSULE_BOTTOM_MARGIN }}
      onContextMenu={(e) => {
        e.preventDefault();
        if (menuAllowed(shownState)) setMenuOpen(true);
      }}
      onPointerDown={() => setMenuOpen(false)}
    >
      <PillView
        state={shownState}
        levelsRef={levelsRef}
        menuOpen={menuOpen}
        hover={hover}
        chord={chord}
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
