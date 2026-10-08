import { useEffect, useRef, type CSSProperties, type MouseEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { formatPoints } from "./lib/format-number";

export function ModalPortal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}

export function SkipLink({ href = "#main-content", children = "Skip to content" }: { href?: string; children?: string }) {
  return <a className="skip-link" href={href}>{children}</a>;
}

const dialogFocusableSelector = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function useDialogFocusTrap(dialogRef: RefObject<HTMLElement | null>, onClose: () => void, enabled = true) {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!enabled) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(dialogFocusableSelector)).filter((element) => !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true");
    const first = focusable()[0] ?? dialog;
    first.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = focusable();
      if (controls.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const firstControl = controls[0];
      const lastControl = controls[controls.length - 1];
      if (!firstControl || !lastControl) return;
      if (event.shiftKey && (document.activeElement === firstControl || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        lastControl.focus();
      } else if (!event.shiftKey && document.activeElement === lastControl) {
        event.preventDefault();
        firstControl.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [dialogRef, enabled]);
}

export type SegmentOption<T extends string> = { value: T; label: string; ariaLabel?: string };

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
  className = "",
}: {
  value: T;
  options: Array<SegmentOption<T>>;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  const activeIndex = options.findIndex((option) => option.value === value);
  const style = {
    "--segment-count": options.length,
    "--segment-index": Math.max(0, activeIndex),
  } as CSSProperties;

  return (
    <div className={`segmented-control${activeIndex < 0 ? " no-active" : ""} ${className}`.trim()} role="group" aria-label={label} style={style}>
      <span className="segment-thumb" aria-hidden="true" />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={value === option.value ? "active" : ""}
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          aria-label={option.ariaLabel}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function shortLeagueName(name: string): string {
  return name
    .replace("Tits Out for The Ladz XII (TWELVE😤)", "Ladz XII")
    .replace("C2C. The real superconference", "C2C Superconference")
    .replace("Hoe Ass Dynasty League", "Hoe Ass Dynasty");
}

export function points(value: number | null): string {
  return formatPoints(value, 1);
}

/** While a player sheet drag is active, the page behind it is inert and text selection is off. */
export function setPlayerSheetDragLock(active: boolean): void {
  const root = document.getElementById("root");
  if (active) {
    root?.setAttribute("inert", "");
    document.documentElement.classList.add("is-sheet-dragging");
    return;
  }
  root?.removeAttribute("inert");
  document.documentElement.classList.remove("is-sheet-dragging");
}

export type SosPosition = "QB" | "RB" | "WR" | "TE";
export type StrengthOfScheduleEntryLike = {
  table: Record<string, Partial<Record<SosPosition, { rank: number }>>>;
};

function matchupTone(entry: StrengthOfScheduleEntryLike | undefined, opponent: string | null, position: string): "" | " sos-soft" | " sos-tough" {
  if (!entry || !opponent || !(["QB", "RB", "WR", "TE"] as string[]).includes(position)) return "";
  const rank = entry.table[opponent]?.[position as SosPosition]?.rank;
  if (typeof rank !== "number") return "";
  if (rank <= 10) return " sos-soft";
  if (rank >= 23) return " sos-tough";
  return "";
}

export function MatchupTag({
  team,
  opponent,
  isAway,
  isBye = false,
  position,
  entry,
  className = "",
  onClick,
}: {
  team: string | null;
  opponent: string | null;
  isAway: boolean | null | undefined;
  isBye?: boolean;
  position: string;
  entry: StrengthOfScheduleEntryLike | undefined;
  className?: string;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const label = opponent ? `${team ?? "FA"} ${isAway ? "@" : "vs"} ${opponent}` : isBye ? "BYE" : "—";
  const tagClassName = `matchup-reference-tag${matchupTone(entry, opponent, position)}${className ? ` ${className}` : ""}`;
  if (!onClick || !team || !opponent) return <span className={tagClassName}>{label}</span>;
  return (
    <button type="button" className={`${tagClassName} matchup-reference-button`} onClick={(event) => onClick?.(event)} aria-label={`View ${team} ${isAway ? "at" : "versus"} ${opponent} matchup data`} aria-haspopup="dialog">
      <span className="matchup-reference-button-label">{label}</span><span className="matchup-reference-arrow" aria-hidden="true">›</span>
    </button>
  );
}
