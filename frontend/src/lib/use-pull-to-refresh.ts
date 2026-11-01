import { useCallback, useEffect, useRef, useState } from "react";

/** How far the finger must drag (after resistance) before letting go refreshes. */
export const PULL_THRESHOLD = 70;
const PULL_MAX = 110;
const RESISTANCE = 0.5;

/** The indicator's travel for a finger drag of `dy` pixels: half the drag, capped. */
export function pullDistance(dy: number): number {
  if (dy <= 0) return 0;
  return Math.min(PULL_MAX, dy * RESISTANCE);
}

/** Whether a touch on `target` may start a page pull: nothing under it is scrolled, and it isn't in a dialog or panel. */
type PullNode = { tagName?: string; scrollTop?: number; parentElement: PullNode | null; matches?: (selector: string) => boolean };

export function canStartPull(target: EventTarget | PullNode | null, pageScrollY: number): boolean {
  if (pageScrollY > 0) return false;
  let el = target && typeof target === "object" && "parentElement" in target ? (target as PullNode) : null;
  for (; el && el.tagName !== "BODY" && el.tagName !== "HTML"; el = el.parentElement) {
    if (el.matches?.('[role="dialog"], [data-no-pull]')) return false;
    if ((el.scrollTop ?? 0) > 0) return false;
  }
  return true;
}

type Phase = "idle" | "pulling" | "refreshing";

/**
 * Pull-to-refresh for touch screens: drag down from the top of the page and let go
 * past the threshold to run `onRefresh` (the same refresh as the header button).
 * The browser's own pull-to-reload is turned off for touch in base.css, so the two
 * never both fire. Touch only; a mouse never starts a pull.
 */
export function usePullToRefresh({ onRefresh, refreshing, disabled = false }: {
  onRefresh: () => void;
  refreshing: boolean;
  disabled?: boolean;
}) {
  const [distance, setDistance] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const start = useRef<{ x: number; y: number } | null>(null);
  const decided = useRef(false);
  const distanceRef = useRef(0);
  const sawRefreshing = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  const refreshingRef = useRef(refreshing);
  refreshingRef.current = refreshing;

  const reset = useCallback(() => {
    start.current = null;
    decided.current = false;
    distanceRef.current = 0;
    setDistance(0);
    setPhase("idle");
  }, []);

  // Turning off mid-pull drops the gesture, so neither the disc nor a stale distance outlives it.
  useEffect(() => {
    if (disabled && phase === "pulling") reset();
  }, [disabled, phase, reset]);

  useEffect(() => {
    if (disabled || typeof window === "undefined" || !window.matchMedia?.("(pointer: coarse)").matches) return undefined;
    // The browser's own pull-to-reload is off only while this gesture is live (see base.css),
    // so screens without it (sign-in) keep the native reload.
    const root = document.documentElement;
    root.classList.add("has-pull-refresh");
    const onStart = (event: TouchEvent) => {
      // No second refresh while one runs (from a pull or the header button).
      if (phase === "refreshing" || refreshingRef.current || event.touches.length !== 1) return;
      const touch = event.touches[0]!;
      if (!canStartPull(event.target, window.scrollY)) return;
      start.current = { x: touch.clientX, y: touch.clientY };
      decided.current = false;
    };
    const onMove = (event: TouchEvent) => {
      if (!start.current) return;
      const touch = event.touches[0]!;
      const dx = touch.clientX - start.current.x;
      const dy = touch.clientY - start.current.y;
      if (!decided.current) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        // A sideways swipe or an upward scroll is not a pull.
        if (Math.abs(dx) > Math.abs(dy) || dy < 0) { start.current = null; return; }
        decided.current = true;
        setPhase("pulling");
      }
      distanceRef.current = pullDistance(dy);
      setDistance(distanceRef.current);
    };
    const onEnd = () => {
      if (!start.current) return;
      const pulled = distanceRef.current;
      start.current = null;
      // A refresh that started mid-pull (the header button) is not doubled on release.
      if (decided.current && pulled >= PULL_THRESHOLD && !refreshingRef.current) {
        sawRefreshing.current = false;
        setPhase("refreshing");
        setDistance(PULL_THRESHOLD);
        onRefreshRef.current();
      } else {
        reset();
      }
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", reset, { passive: true });
    return () => {
      root.classList.remove("has-pull-refresh");
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", reset);
    };
  }, [disabled, phase, reset]);

  // Hold the spinner until the refresh finishes; if it never starts (already running), let go after a beat.
  useEffect(() => {
    if (phase !== "refreshing") return undefined;
    if (refreshing) { sawRefreshing.current = true; return undefined; }
    if (sawRefreshing.current) { reset(); return undefined; }
    const timer = window.setTimeout(reset, 600);
    return () => window.clearTimeout(timer);
  }, [phase, refreshing, reset]);

  return { distance, phase, ready: distance >= PULL_THRESHOLD };
}
