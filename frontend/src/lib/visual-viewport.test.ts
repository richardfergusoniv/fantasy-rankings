import { describe, expect, it, vi } from "vitest";
import {
  trackVisualViewport,
  VISUAL_VIEWPORT_HEIGHT_VAR,
  VISUAL_VIEWPORT_TOP_VAR,
  type VisualViewportLike,
} from "./visual-viewport";

function fakeViewport(height: number, offsetTop: number) {
  const listeners = new Map<string, Set<() => void>>();
  const viewport: VisualViewportLike & { fire: (type: string) => void } = {
    height,
    offsetTop,
    addEventListener: (type, listener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(listener);
    },
    removeEventListener: (type, listener) => {
      listeners.get(type)?.delete(listener);
    },
    fire: (type) => {
      for (const listener of listeners.get(type) ?? []) listener();
    },
  };
  return viewport;
}

function fakeTarget() {
  const values = new Map<string, string>();
  return {
    values,
    style: {
      setProperty: (name: string, value: string) => {
        values.set(name, value);
      },
      removeProperty: (name: string) => {
        values.delete(name);
      },
    },
  };
}

describe("trackVisualViewport", () => {
  it("publishes the current viewport geometry immediately", () => {
    const target = fakeTarget();
    const stop = trackVisualViewport(target, fakeViewport(812, 0));
    expect(target.values.get(VISUAL_VIEWPORT_HEIGHT_VAR)).toBe("812px");
    expect(target.values.get(VISUAL_VIEWPORT_TOP_VAR)).toBe("0px");
    stop?.();
  });

  it("follows the viewport as the keyboard opens and the view scrolls", () => {
    const target = fakeTarget();
    const viewport = fakeViewport(812, 0);
    const stop = trackVisualViewport(target, viewport);
    viewport.height = 460;
    viewport.offsetTop = 352;
    viewport.fire("resize");
    expect(target.values.get(VISUAL_VIEWPORT_HEIGHT_VAR)).toBe("460px");
    expect(target.values.get(VISUAL_VIEWPORT_TOP_VAR)).toBe("352px");
    viewport.fire("scroll");
    expect(target.values.get(VISUAL_VIEWPORT_TOP_VAR)).toBe("352px");
    stop?.();
  });

  it("removes the properties and stops listening on unsubscribe", () => {
    const target = fakeTarget();
    const viewport = fakeViewport(812, 0);
    const stop = trackVisualViewport(target, viewport);
    stop?.();
    expect(target.values.has(VISUAL_VIEWPORT_HEIGHT_VAR)).toBe(false);
    expect(target.values.has(VISUAL_VIEWPORT_TOP_VAR)).toBe(false);
    viewport.height = 400;
    viewport.fire("resize");
    expect(target.values.has(VISUAL_VIEWPORT_HEIGHT_VAR)).toBe(false);
  });

  it("is a no-op without a visual viewport", () => {
    const target = fakeTarget();
    const stop = trackVisualViewport(target, null);
    expect(stop).toBeNull();
    expect(target.values.size).toBe(0);
    expect(vi.fn()).toBeDefined();
  });
});
