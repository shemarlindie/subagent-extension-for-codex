import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { Event } from "../core/types";

const TOP_BUFFER = 48;
type Position = { element: HTMLElement; top: number; bottom: number };

// The timeline scrolls itself unless a short layout hands scrolling to the inspector.
function scroller(viewport: HTMLElement) {
  for (let element: HTMLElement | null = viewport; element;) {
    if (/auto|scroll/.test(getComputedStyle(element).overflowY)) return element;
    element = element.parentElement;
  }
  return viewport;
}

// How far the reader has scrolled past the newest activity.
function offset(viewport: HTMLElement, container: HTMLElement) {
  if (container === viewport) return viewport.scrollTop;
  return Math.max(
    0,
    container.getBoundingClientRect().top -
      viewport.getBoundingClientRect().top,
  );
}

export function useActivityScroll(events: Event[], active = true) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(active);
  const wasActive = useRef(active);
  const pinnedRef = useRef(true);
  const [pinned, setPinned] = useState(true);
  const positions = useRef(new Map<string, Position>());
  const anchor = useRef<Position | undefined>(undefined);
  const rememberedScrollTop = useRef(0);
  const animations = useRef<Animation[]>([]);
  const mounted = useRef(false);
  const restoredScrollTop = useRef<number | undefined>(undefined);

  function remember() {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const container = scroller(viewport);
    const top = container.getBoundingClientRect().top;
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
    rememberedScrollTop.current = container.scrollTop;
    anchor.current = [...next.values()].find((position) => position.bottom > 0);
  }

  const onScroll = useEffectEvent(() => {
    const viewport = viewportRef.current;
    if (!activeRef.current || !viewport) return;
    const container = scroller(viewport);
    const top = container.scrollTop;
    const restored = restoredScrollTop.current;
    restoredScrollTop.current = undefined;
    // The browser also emits scroll after our own anchor correction.
    if (restored !== undefined && Math.abs(top - restored) < 1) return;
    for (const animation of animations.current) animation.cancel();
    animations.current = [];
    const next = offset(viewport, container) <= TOP_BUFFER;
    pinnedRef.current = next;
    setPinned(next);
    remember();
  });

  function scrollToTop() {
    for (const animation of animations.current) animation.cancel();
    animations.current = [];
    pinnedRef.current = true;
    setPinned(true);
    const viewport = viewportRef.current;
    if (viewport) {
      const container = scroller(viewport);
      const target = container.scrollTop - offset(viewport, container);
      // Replace any stale correction marker so only this jump's scroll event is ignored.
      restoredScrollTop.current =
        container.scrollTop !== target ? target : undefined;
      container.scrollTop = target;
      viewport.focus({ preventScroll: true });
    }
    remember();
  }

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    activeRef.current = active;
    const revealed = active && !wasActive.current;
    wasActive.current = active;
    // A hidden tab has no layout; keep the last baseline until it is shown again.
    if (!viewport || !active) return;
    // Measure without an in-flight transform before restoring the reading position.
    for (const animation of animations.current) animation.cancel();
    animations.current = [];
    const container = scroller(viewport);
    const previous = positions.current;
    const previousScrollTop = container.scrollTop;
    const previousOffset = offset(viewport, container);
    // A reader scroll can land before its scroll event; never pull it back to the top.
    // Other tabs can move a shared scroller, but the reader did not leave the latest activity.
    if (pinnedRef.current && !revealed && previousOffset > TOP_BUFFER) {
      pinnedRef.current = false;
      setPinned(false);
    }
    if (pinnedRef.current) container.scrollTop -= previousOffset;
    else {
      // Fall back to another visible group when the event tail drops the anchor.
      const retained = anchor.current?.element.isConnected
        ? anchor.current
        : [...previous.values()].find(
            (position) => position.bottom > 0 && position.element.isConnected,
          );
      if (retained) {
        // Measure against the reader's current offset, including unhandled scrolls.
        // A revealed tab returns to its remembered offset instead.
        const scrolled = revealed
          ? 0
          : previousScrollTop - rememberedScrollTop.current;
        container.scrollTop +=
          retained.element.getBoundingClientRect().top -
          container.getBoundingClientRect().top -
          (retained.top - scrolled);
      }
    }
    if (container.scrollTop !== previousScrollTop)
      restoredScrollTop.current = container.scrollTop;
    // Save settled layout before transforms so the next update has a stable baseline.
    remember();
    const reducedMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    // Rows that changed while hidden appear in place rather than replaying motion.
    if (!reducedMotion && mounted.current && !revealed) {
      // Move retained rows from their old position and fade newly arrived rows in.
      for (const [id, position] of positions.current) {
        const old = previous.get(id);
        const delta = old ? old.top - position.top : -12;
        if (position.bottom < 0 || position.top > container.clientHeight)
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
  }, [events, active]);

  // Scroll events do not bubble, so capture them from whichever element scrolls.
  useEffect(() => {
    const document = viewportRef.current?.ownerDocument;
    if (!document) return;
    const listener = (event: globalThis.Event) => {
      const viewport = viewportRef.current;
      // Skip unrelated scrollers before measuring styles up the tree.
      if (!viewport || !(event.target instanceof Node)) return;
      if (!event.target.contains(viewport)) return;
      if (event.target === scroller(viewport)) onScroll();
    };
    document.addEventListener("scroll", listener, true);
    return () => document.removeEventListener("scroll", listener, true);
  }, []);

  useLayoutEffect(
    () => () => {
      for (const animation of animations.current) animation.cancel();
    },
    [],
  );

  return { viewportRef, pinned, scrollToTop };
}
