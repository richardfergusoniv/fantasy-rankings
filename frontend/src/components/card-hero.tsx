import type { ReactNode } from "react";

export type CardHeroItem = {
  label: string;
  value: ReactNode;
  /** Small line under the value: a rank, a comparison, a count. */
  sub?: ReactNode;
  /** `good` renders the value (or the sub line when set) in the link amber. */
  tone?: "good";
  /** Tint the big value instead of the sub line. */
  valueTone?: "good" | "bad";
};

/** Two or three headline numbers between hairlines, the way the player card opens. */
export function CardHero({ items, ariaLabel }: { items: readonly CardHeroItem[]; ariaLabel: string }) {
  return (
    <div className="card-hero" role="group" aria-label={ariaLabel} style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((item) => (
        <div key={item.label}>
          <div className="card-hero-k">{item.label}</div>
          <div className={`card-hero-v${item.valueTone ? ` is-${item.valueTone}` : ""}`}>{item.value}</div>
          {item.sub ? <div className={`card-hero-s${item.tone === "good" ? " is-good" : ""}`}>{item.sub}</div> : null}
        </div>
      ))}
    </div>
  );
}
