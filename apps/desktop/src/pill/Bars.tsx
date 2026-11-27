import { useEffect, useRef, type RefObject } from "react";
import { BAR_COUNT, barScale, smoothLevels } from "./pillLogic";

const REDUCED_TICK_MS = 250;
const EPS = 0.002;

/**
 * Nine rounded bars driven by mic level. Mounted only while listening, it runs one
 * requestAnimationFrame loop that eases toward `levelsRef.current` and writes
 * transform: scaleY straight to the elements: no React renders, no layout.
 * With reduced motion there is no loop and no easing: a single meter (the mean level, so all
 * bars share one height profile) is re-read from `levelsRef` about 4 times a second.
 */
export function Bars({ levelsRef, reduced = false }: { levelsRef: RefObject<readonly number[]>; reduced?: boolean }) {
  const els = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    const write = (i: number, s: number) => {
      const el = els.current[i];
      if (el) el.style.transform = `scaleY(${s})`;
    };
    if (reduced) {
      const meter = () => {
        const l = levelsRef.current;
        const mean = l.length ? l.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0) / BAR_COUNT : 0;
        for (let i = 0; i < BAR_COUNT; i++) write(i, barScale(mean, i));
      };
      meter();
      const id = setInterval(meter, REDUCED_TICK_MS);
      return () => clearInterval(id);
    }
    let shown: number[] = new Array(BAR_COUNT).fill(0);
    const written = new Array<number>(BAR_COUNT).fill(-1);
    let last = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      shown = smoothLevels(shown, levelsRef.current, now - last);
      last = now;
      for (let i = 0; i < BAR_COUNT; i++) {
        const s = barScale(shown[i], i);
        if (Math.abs(s - written[i]) > EPS) {
          write(i, s);
          written[i] = s;
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [levelsRef, reduced]);

  return (
    <div className="pill-bars" aria-hidden="true">
      {Array.from({ length: BAR_COUNT }, (_, i) => (
        <span
          key={i}
          className="pill-bar"
          ref={(el) => {
            els.current[i] = el;
          }}
        />
      ))}
    </div>
  );
}

/** Three slow dots: what the bars settle into while Utter is working. */
export function ThinkingDots() {
  return (
    <div className="pill-dots" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}
