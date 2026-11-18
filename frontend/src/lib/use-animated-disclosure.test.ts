import { afterEach, describe, expect, it, vi } from "vitest";
import { createAnimatedDisclosureClose, DISCLOSURE_CLOSE_FALLBACK_MS } from "./use-animated-disclosure";

class FakeClassList {
  private names = new Set<string>();
  add = (name: string) => {
    this.names.add(name);
  };
  remove = (name: string) => {
    this.names.delete(name);
  };
  contains = (name: string) => this.names.has(name);
}

type TransitionListener = (event: { propertyName: string; target: unknown }) => void;

class FakeBody {
  /**
   * Stands in for the DOM element a native transitionend targets. It is a
   * distinct object from the FakeBody adapter on purpose: a real event's
   * target is the element, never the wrapper the listener registered
   * through, and the controller must finish on the element's events.
   */
  readonly element = {};
  private listeners = new Set<TransitionListener>();
  addEventListener = (_type: "transitionend", listener: TransitionListener) => {
    this.listeners.add(listener);
  };
  removeEventListener = (_type: "transitionend", listener: TransitionListener) => {
    this.listeners.delete(listener);
  };
  fireTransitionEnd(propertyName: string, target: unknown = this.element) {
    for (const listener of [...this.listeners]) listener({ propertyName, target });
  }
  get listenerCount() {
    return this.listeners.size;
  }
}

function setup({ open = true, reducedMotion = false } = {}) {
  const details = { open, classList: new FakeClassList() };
  const body = new FakeBody();
  const close = createAnimatedDisclosureClose({ details, body, reducedMotion: () => reducedMotion });
  return { details, body, close };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("createAnimatedDisclosureClose", () => {
  it("lets the native toggle run when the disclosure is closed", () => {
    const { details, close } = setup({ open: false });
    expect(close.requestToggle()).toBe(false);
    expect(details.classList.contains("is-closing")).toBe(false);
  });

  it("starts the glide on close and removes open when the rows transition ends", () => {
    const { details, body, close } = setup();
    expect(close.requestToggle()).toBe(true);
    expect(details.classList.contains("is-closing")).toBe(true);
    expect(details.open).toBe(true);
    body.fireTransitionEnd("grid-template-rows");
    expect(details.open).toBe(false);
    expect(details.classList.contains("is-closing")).toBe(false);
    expect(body.listenerCount).toBe(0);
  });

  it("ignores transitionend for other properties and other targets", () => {
    const { details, body, close } = setup();
    close.requestToggle();
    body.fireTransitionEnd("visibility");
    expect(details.open).toBe(true);
    body.fireTransitionEnd("grid-template-rows", {});
    expect(details.open).toBe(true);
    body.fireTransitionEnd("grid-template-rows");
    expect(details.open).toBe(false);
  });

  it("finishes via the fallback timer when transitionend never fires", () => {
    vi.useFakeTimers();
    const { details, close } = setup();
    close.requestToggle();
    vi.advanceTimersByTime(DISCLOSURE_CLOSE_FALLBACK_MS - 1);
    expect(details.open).toBe(true);
    vi.advanceTimersByTime(1);
    expect(details.open).toBe(false);
    expect(details.classList.contains("is-closing")).toBe(false);
  });

  it("a second toggle mid-close cancels back to fully open with nothing pending", () => {
    vi.useFakeTimers();
    const { details, body, close } = setup();
    expect(close.requestToggle()).toBe(true);
    expect(close.requestToggle()).toBe(true);
    expect(details.open).toBe(true);
    expect(details.classList.contains("is-closing")).toBe(false);
    expect(body.listenerCount).toBe(0);
    vi.advanceTimersByTime(DISCLOSURE_CLOSE_FALLBACK_MS * 2);
    body.fireTransitionEnd("grid-template-rows");
    expect(details.open).toBe(true);
  });

  it("never intercepts under reduced motion, so the native close stays instant", () => {
    const { details, close } = setup({ reducedMotion: true });
    expect(close.requestToggle()).toBe(false);
    expect(details.classList.contains("is-closing")).toBe(false);
    expect(details.open).toBe(true);
  });

  it("dispose mid-close cancels the pending close", () => {
    vi.useFakeTimers();
    const { details, body, close } = setup();
    close.requestToggle();
    close.dispose();
    expect(details.classList.contains("is-closing")).toBe(false);
    expect(body.listenerCount).toBe(0);
    vi.advanceTimersByTime(DISCLOSURE_CLOSE_FALLBACK_MS * 2);
    expect(details.open).toBe(true);
  });
});
