import { afterEach, describe, expect, it, vi } from "vitest";
import { prefersReducedMotion, viewTransitionSupported, withViewTransition } from "./view-transition";

type TransitionCallback = () => void;

function stubBrowser(options: { supported: boolean; reducedMotion?: boolean }) {
  const startViewTransition = vi.fn<(callback: TransitionCallback) => void>();
  vi.stubGlobal("document", options.supported ? { startViewTransition } : {});
  vi.stubGlobal("window", {
    matchMedia: (query: string) => ({
      matches: Boolean(options.reducedMotion) && query === "(prefers-reduced-motion: reduce)",
    }),
  });
  return { startViewTransition };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("viewTransitionSupported", () => {
  it("is true only when the document has startViewTransition", () => {
    expect(viewTransitionSupported({ startViewTransition: () => undefined } as unknown as Document)).toBe(true);
    expect(viewTransitionSupported({} as Document)).toBe(false);
  });
});

describe("prefersReducedMotion", () => {
  it("follows the media query, and is false without matchMedia", () => {
    const reduce = { matchMedia: () => ({ matches: true }) } as unknown as Window;
    const noPreference = { matchMedia: () => ({ matches: false }) } as unknown as Window;
    expect(prefersReducedMotion(reduce)).toBe(true);
    expect(prefersReducedMotion(noPreference)).toBe(false);
    expect(prefersReducedMotion({} as Window)).toBe(false);
  });
});

describe("withViewTransition", () => {
  it("runs the update directly when the API is unsupported", () => {
    stubBrowser({ supported: false });
    const update = vi.fn();
    withViewTransition(update);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("runs the update directly for reduced-motion users even when supported", () => {
    const { startViewTransition } = stubBrowser({ supported: true, reducedMotion: true });
    const update = vi.fn();
    withViewTransition(update);
    expect(update).toHaveBeenCalledTimes(1);
    expect(startViewTransition).not.toHaveBeenCalled();
  });

  it("defers the update into the transition callback when supported", () => {
    const { startViewTransition } = stubBrowser({ supported: true });
    const update = vi.fn();
    withViewTransition(update);
    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
    const callback = startViewTransition.mock.calls[0]?.[0];
    callback?.();
    expect(update).toHaveBeenCalledTimes(1);
  });
});
