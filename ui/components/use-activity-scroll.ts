import { useLayoutEffect, useRef, useState } from "react";
import type { Event } from "../core/types";

const TOP_BUFFER = 48;
type Position = { element: HTMLElement; top: number; bottom: number };

export function useActivityScroll(events: Event[]) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const [pinned, setPinned] = useState(true);
  const positions = useRef(new Map<string, Position>());
  const anchor = useRef<Position | undefined>(undefined);
  const animations = useRef<Animation[]>([]);
  const mounted = useRef(false);
  const restoredScrollTop = useRef<number | undefined>(undefined);

  function remember() {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const top = viewport.getBoundingClientRect().top;
    const next = new Map<string, Position>();
    for (const element of viewport.querySelectorAll<HTMLElement>(
      "[data-activity-id]",
    )) {
      const rect = element.getBoundingClientRect();
      next.set(element.dataset.activityId!, {
        element,
        top: rect.top - top,
        bottom: rect.bottom - top,
      });
    }
    positions.current = next;
    anchor.current = [...next.values()].find((position) => position.bottom > 0);
  }

  function onScroll() {
    const top = viewportRef.current?.scrollTop ?? 0;
    const restored = restoredScrollTop.current;
    restoredScrollTop.current = undefined;
    // The browser also emits scroll after our own anchor correction.
    if (restored !== undefined && Math.abs(top - restored) < 1) return;
    for (const animation of animations.current) animation.cancel();
    animations.current = [];
    const next = top <= TOP_BUFFER;
    pinnedRef.current = next;
    setPinned(next);
    remember();
  }

  function scrollToTop() {
    for (const animation of animations.current) animation.cancel();
    animations.current = [];
    pinnedRef.current = true;
    setPinned(true);
    const viewport = viewportRef.current;
    if (viewport) {
      if (viewport.scrollTop !== 0) restoredScrollTop.current = 0;
      viewport.scrollTop = 0;
      viewport.focus({ preventScroll: true });
    }
    remember();
  }

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    // Measure without an in-flight transform before restoring the reading position.
    for (const animation of animations.current) animation.cancel();
    animations.current = [];
    const previous = positions.current;
    const previousScrollTop = viewport.scrollTop;
    if (pinnedRef.current) viewport.scrollTop = 0;
    else {
      // Fall back to another visible group when the event tail drops the anchor.
      const retained = anchor.current?.element.isConnected
        ? anchor.current
        : [...previous.values()].find(
            (position) => position.bottom > 0 && position.element.isConnected,
          );
      if (retained) {
        viewport.scrollTop +=
          retained.element.getBoundingClientRect().top -
          viewport.getBoundingClientRect().top -
          retained.top;
      }
    }
    if (viewport.scrollTop !== previousScrollTop)
      restoredScrollTop.current = viewport.scrollTop;
    // Save settled layout before transforms so the next update has a stable baseline.
    remember();
    const reducedMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (!reducedMotion && mounted.current) {
      // Move retained rows from their old position and fade newly arrived rows in.
      for (const [id, position] of positions.current) {
        const old = previous.get(id);
        const delta = old ? old.top - position.top : -12;
        if (position.bottom < 0 || position.top > viewport.clientHeight)
          continue;
        if (!old || Math.abs(delta) > 1) {
          const animation = position.element.animate?.(
            [
              { transform: `translateY(${delta}px)`, opacity: old ? 1 : 0 },
              { transform: "translateY(0)", opacity: 1 },
            ],
            { duration: 220, easing: "ease-out" },
          );
          if (animation) animations.current.push(animation);
        }
      }
    }
    mounted.current = true;
  }, [events]);

  useLayoutEffect(
    () => () => {
      for (const animation of animations.current) animation.cancel();
    },
    [],
  );

  return { viewportRef, pinned, onScroll, scrollToTop };
}
