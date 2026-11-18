import { useCallback, useEffect, useRef } from "react";

/**
 * The closing glide for .disclosure bodies in overrides.css runs .18s; the
 * fallback that finishes a close when transitionend never arrives (a
 * backgrounded tab, an interrupted transition) waits a beat past it.
 */
export const DISCLOSURE_CLOSE_FALLBACK_MS = 270;

type DisclosureDetails = {
  open: boolean;
  classList: { add: (name: string) => void; remove: (name: string) => void };
};

type DisclosureTransitionEvent = { propertyName: string; target: unknown };

type DisclosureBody = {
  addEventListener: (type: "transitionend", listener: (event: DisclosureTransitionEvent) => void) => void;
  removeEventListener: (type: "transitionend", listener: (event: DisclosureTransitionEvent) => void) => void;
};

/**
 * The close sequencing for an animated details disclosure. A native details
 * stops rendering its content the moment open is removed, so a CSS closing
 * transition can never play on its own: opening stays native, but a close is
 * intercepted — the body glides shut under an is-closing class while open is
 * still present, and only when the glide ends is open removed, restoring the
 * native closed guarantee (content unrendered and unfocusable). A second
 * toggle mid-close cancels back to fully open, and reduced motion never
 * intercepts, so the close stays instant there.
 */
export function createAnimatedDisclosureClose({ details, body, reducedMotion }: {
  details: DisclosureDetails;
  body: DisclosureBody;
  reducedMotion: () => boolean;
}) {
  let closing = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function stopWatching() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    body.removeEventListener("transitionend", onTransitionEnd);
  }

  function finish() {
    if (!closing) return;
    closing = false;
    stopWatching();
    details.classList.remove("is-closing");
    details.open = false;
  }

  function onTransitionEnd(event: DisclosureTransitionEvent) {
    if (event.target === body && event.propertyName === "grid-template-rows") finish();
  }

  function cancel() {
    if (!closing) return;
    closing = false;
    stopWatching();
    details.classList.remove("is-closing");
  }

  return {
    /**
     * A summary activation. Returns true when the activation was consumed
     * (a close started, or a mid-close re-open) and the caller must prevent
     * the native toggle; false lets the native toggle run (opening, or an
     * instant reduced-motion close).
     */
    requestToggle(): boolean {
      if (!details.open || reducedMotion()) return false;
      if (closing) {
        cancel();
        return true;
      }
      closing = true;
      details.classList.add("is-closing");
      body.addEventListener("transitionend", onTransitionEnd);
      timer = setTimeout(finish, DISCLOSURE_CLOSE_FALLBACK_MS);
      return true;
    },
    dispose: cancel,
  };
}

/**
 * Wires createAnimatedDisclosureClose to a .disclosure details element. A
 * callback ref, so the wiring follows the element as it mounts and unmounts
 * (both disclosures render conditionally). Purely additive: without this
 * hook the details still toggles natively, just without the closing glide.
 */
export function useAnimatedDisclosure() {
  const detachRef = useRef<(() => void) | null>(null);

  const ref = useCallback((details: HTMLDetailsElement | null) => {
    detachRef.current?.();
    detachRef.current = null;
    if (!details) return;
    const summary = details.querySelector("summary");
    const bodyEl = details.querySelector<HTMLElement>(".disclosure-body");
    if (!summary || !bodyEl) return;
    const close = createAnimatedDisclosureClose({
      details,
      body: {
        addEventListener: (type, listener) => bodyEl.addEventListener(type, listener),
        removeEventListener: (type, listener) => bodyEl.removeEventListener(type, listener),
      },
      reducedMotion: () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    });
    const onClick = (event: MouseEvent) => {
      if (close.requestToggle()) event.preventDefault();
    };
    summary.addEventListener("click", onClick);
    detachRef.current = () => {
      summary.removeEventListener("click", onClick);
      close.dispose();
    };
  }, []);

  useEffect(() => () => {
    detachRef.current?.();
    detachRef.current = null;
  }, []);

  return ref;
}
