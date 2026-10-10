import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

const focusableSelector = "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

function focusablesIn(element: HTMLElement): HTMLElement[] {
  return Array.from(element.querySelectorAll<HTMLElement>(focusableSelector)).filter((node) => !node.hasAttribute("disabled") && node.tabIndex >= 0 && node.getAttribute("aria-hidden") !== "true");
}

function readScrollMargin(node: HTMLElement): number {
  return node.getBoundingClientRect().top + window.scrollY;
}

/**
 * Window-scrolled list. The page, sticky header, and bottom nav keep scrolling;
 * only the mounted rows change.
 */
export function WindowVirtualList({
  count,
  estimateSize,
  getKey,
  className = "",
  children,
}: {
  count: number;
  estimateSize: number;
  getKey?: (index: number) => string | number;
  className?: string;
  children: (index: number) => ReactNode;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<{ index: number; edge: "start" | "end" } | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  useLayoutEffect(() => {
    const node = parentRef.current;
    if (!node) return;
    const update = () => {
      const next = readScrollMargin(node);
      setScrollMargin((current) => (Math.abs(current - next) < 0.5 ? current : next));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(document.body);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [count]);

  const virtualizer = useWindowVirtualizer({
    count,
    estimateSize: () => estimateSize,
    overscan: 8,
    scrollMargin,
    getItemKey: getKey,
  });

  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    const parent = parentRef.current;
    if (!pending || !parent) return;
    if (pending.index < 0 || pending.index >= count) {
      pendingFocus.current = null;
      return;
    }
    const row = parent.querySelector<HTMLElement>(`[data-index="${pending.index}"]`);
    if (!row) return;
    const focusable = focusablesIn(row);
    const target = pending.edge === "end" ? focusable[focusable.length - 1] : focusable[0];
    if (!target) return;
    pendingFocus.current = null;
    target.focus();
  });

  function focusIndex(index: number, edge: "start" | "end") {
    const parent = parentRef.current;
    const row = parent?.querySelector<HTMLElement>(`[data-index="${index}"]`);
    if (row) {
      const focusable = focusablesIn(row);
      const target = edge === "end" ? focusable[focusable.length - 1] : focusable[0];
      target?.focus();
      return;
    }
    pendingFocus.current = { index, edge };
    virtualizer.scrollToIndex(index, { align: "auto" });
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const parent = parentRef.current;
    const active = document.activeElement;
    if (!parent || !(active instanceof HTMLElement) || !parent.contains(active)) return;
    const row = active.closest<HTMLElement>("[data-index]");
    if (!row || !parent.contains(row)) return;
    const index = Number(row.dataset.index);
    if (!Number.isInteger(index)) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (event.altKey || event.metaKey || event.ctrlKey) return;
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= count) return;
      event.preventDefault();
      focusIndex(nextIndex, "start");
      return;
    }

    if (event.key !== "Tab" || event.altKey || event.metaKey || event.ctrlKey) return;
    const focusable = focusablesIn(row);
    const position = focusable.indexOf(active);
    if (position < 0) return;
    const direction = event.shiftKey ? -1 : 1;
    if (focusable[position + direction]) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= count) return;
    event.preventDefault();
    focusIndex(nextIndex, direction < 0 ? "end" : "start");
  }

  const items = virtualizer.getVirtualItems();

  return (
    <div
      ref={parentRef}
      className={`virtual-window-list${className ? ` ${className}` : ""}`}
      style={{ height: virtualizer.getTotalSize() }}
      onKeyDown={onKeyDown}
    >
      {items.map((virtualRow) => (
        <div
          key={virtualRow.key}
          data-index={virtualRow.index}
          data-last={virtualRow.index === count - 1 ? "true" : undefined}
          ref={virtualizer.measureElement}
          className="virtual-window-row"
          style={{ transform: `translateY(${virtualRow.start - scrollMargin}px)` }}
        >
          {children(virtualRow.index)}
        </div>
      ))}
    </div>
  );
}
