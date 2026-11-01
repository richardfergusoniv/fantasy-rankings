import { describe, expect, it } from "vitest";
import { canStartPull, PULL_THRESHOLD, pullDistance } from "./use-pull-to-refresh";

describe("pullDistance", () => {
  it("moves half the drag, never up, and caps", () => {
    expect(pullDistance(-20)).toBe(0);
    expect(pullDistance(100)).toBe(50);
    expect(pullDistance(2 * PULL_THRESHOLD)).toBe(PULL_THRESHOLD);
    expect(pullDistance(1000)).toBe(110);
  });
});

type Node = { tagName: string; scrollTop: number; parentElement: Node | null; matches: (selector: string) => boolean };
const node = (parent: Node | null, opts: { dialog?: boolean; scrollTop?: number; tag?: string } = {}): Node => ({
  tagName: opts.tag ?? "DIV",
  scrollTop: opts.scrollTop ?? 0,
  parentElement: parent,
  matches: () => Boolean(opts.dialog),
});

describe("canStartPull", () => {
  const body = node(null, { tag: "BODY" });
  it("starts only at the top of the page", () => {
    const plain = node(node(body));
    expect(canStartPull(plain, 0)).toBe(true);
    expect(canStartPull(plain, 40)).toBe(false);
  });

  it("never starts inside a dialog or a scrolled panel", () => {
    expect(canStartPull(node(node(body, { dialog: true })), 0)).toBe(false);
    expect(canStartPull(node(node(body, { scrollTop: 30 })), 0)).toBe(false);
  });
});
