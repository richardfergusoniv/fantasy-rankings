/**
 * Tracks the visual viewport (the part of the page actually visible, which
 * shrinks when the on-screen keyboard opens) as CSS custom properties on a
 * target element, so fixed UI can anchor to what the user can see instead of
 * the full layout viewport. iOS Safari positions fixed elements against the
 * layout viewport and scrolls the visual viewport on input focus, which left
 * the ask sheet floating above the keyboard with the page showing through
 * underneath. Pinning the sheet and its overlay to these variables keeps the
 * composer resting directly above the keyboard.
 */

export interface VisualViewportLike {
  height: number;
  offsetTop: number;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
}

export interface StyleTargetLike {
  style: {
    setProperty: (name: string, value: string) => void;
    removeProperty: (name: string) => void;
  };
}

export const VISUAL_VIEWPORT_HEIGHT_VAR = "--vv-height";
export const VISUAL_VIEWPORT_TOP_VAR = "--vv-top";

/**
 * Publishes the viewport's height and top offset as `--vv-height` / `--vv-top`
 * (px) on the target, updating on every visual-viewport resize and scroll.
 * Returns an unsubscribe that removes the listeners and the properties, or
 * null when no visual viewport is available (the CSS fallbacks then keep the
 * previous layout-viewport geometry).
 */
export function trackVisualViewport(
  target: StyleTargetLike,
  viewport: VisualViewportLike | null | undefined,
): (() => void) | null {
  if (!viewport) return null;
  const update = () => {
    target.style.setProperty(VISUAL_VIEWPORT_HEIGHT_VAR, `${viewport.height}px`);
    target.style.setProperty(VISUAL_VIEWPORT_TOP_VAR, `${viewport.offsetTop}px`);
  };
  update();
  viewport.addEventListener("resize", update);
  viewport.addEventListener("scroll", update);
  return () => {
    viewport.removeEventListener("resize", update);
    viewport.removeEventListener("scroll", update);
    target.style.removeProperty(VISUAL_VIEWPORT_HEIGHT_VAR);
    target.style.removeProperty(VISUAL_VIEWPORT_TOP_VAR);
  };
}
