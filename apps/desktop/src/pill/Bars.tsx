import { BAR_COUNT, barHeight, staticBarHeights } from "./pillLogic";

const STATIC = staticBarHeights();

/** Twelve rounded bars driven by mic level. With reduced motion they hold a fixed profile. */
export function Bars({ levels, reduced = false }: { levels: readonly number[]; reduced?: boolean }) {
  return (
    <div className="pill-bars" aria-hidden="true">
      {Array.from({ length: BAR_COUNT }, (_, i) => (
        <span
          key={i}
          className="pill-bar"
          style={{ height: reduced ? STATIC[i] : barHeight(levels[i] ?? 0, i) }}
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
