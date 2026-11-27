import { useEffect, useRef, type RefObject } from "react";
import { BAR_COUNT, barScale, smoothLevels } from "./pillLogic";

const STATIC = Array.from({ length: BAR_COUNT }, (_, i) => barScale(0.35, i));
const EPS = 0.002;

/**
 * Nine rounded bars driven by mic level. Mounted only while listening, it runs one
 * requestAnimationFrame loop that eases toward `levelsRef.current` and writes
 * transform: scaleY straight to the elements: no React renders, no layout.
 * With reduced motion the bars hold a fixed profile and no loop runs.
 */
export function Bars({ levelsRef, reduced = false }: { levelsRef: RefObject<readonly number[]>; reduced?: boolean }) {
  const els = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    const write = (i: number, s: number) => {
      const el = els.current[i];
      if (el) el.style.transform = `scaleY(${s})`;
    };
    if (reduced) {
      STATIC.forEach((s, i) => write(i, s));
      return;
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
