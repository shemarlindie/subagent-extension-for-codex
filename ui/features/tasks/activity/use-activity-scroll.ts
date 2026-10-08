import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { MOTION, reducedMotion } from "../../../shared/components/motion-utils";
import type { Event } from "../../../shared/state/types";
import { scrollContainer as scroller } from "../../../shared/utils/scroll-container";
import type { ReadingState } from "../evidence/reading-state";

const TOP_BUFFER = 48;
// How long a smooth return may go without progress before it counts as stopped.
const GLIDE_STALL = 1500;

type Position = { element: HTMLElement; top: number; bottom: number };

// How far the reader has scrolled past the newest activity.
function offset(viewport: HTMLElement, container: HTMLElement) {
  if (container === viewport) return viewport.scrollTop;

  return Math.max(
    0,
    container.getBoundingClientRect().top -
      viewport.getBoundingClientRect().top,
  );
}

export function useActivityScroll(
  events: Event[],
  active = true,
  reading?: ReadingState,
) {
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

  // Where a smooth return to the latest activity is heading, how far it had left,
  // and whether it has moved yet (a scroll end before then belongs to an earlier scroll).
  const glide = useRef<
    { target: number; distance: number; moved: boolean } | undefined
  >(undefined);

  const glideTimer = useRef<number | undefined>(undefined);

  const remember = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const container = scroller(viewport);
    const top = container.getBoundingClientRect().top;
    const next = new Map<string, Position>();

    for (const element of Array.from(
      viewport.querySelectorAll<HTMLElement>("[data-activity-id]"),
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

    if (reading) {
      const entry = [...next.entries()].find(
        ([, position]) => position.bottom > 0,
      );

      reading.position = {
        top: container.scrollTop,
        pinned: pinnedRef.current,
        anchor: entry && { id: entry[0], top: entry[1].top },
      };
    }
  }, [reading]);

  const onScroll = useEffectEvent(() => {
    const viewport = viewportRef.current;
    if (!activeRef.current || !viewport) return;
    const container = scroller(viewport);
    const top = container.scrollTop;
    const restored = restoredScrollTop.current;
    restoredScrollTop.current = undefined;
    // The browser also emits scroll after our own anchor correction.
    if (restored !== undefined && Math.abs(top - restored) < 1) return;

    // A smooth return stays pinned while it closes in; moving away means the reader took over.
    if (glide.current) {
      const distance = Math.abs(top - glide.current.target);

      if (distance < 1) {
        glide.current = undefined;
        remember();

        return;
      }

      if (distance <= glide.current.distance + 1) {
        // A late event from an earlier scroll repeats the start position; only progress counts.
        if (distance < glide.current.distance - 1) {
          glide.current.moved = true;
          awaitGlide();
        }

        glide.current.distance = distance;

        return;
      }

      glide.current = undefined;
    }

    judge(viewport);
  });

  // The reader is pinned while within the buffer of the latest activity.
  function judge(viewport: HTMLElement) {
    for (const animation of animations.current) animation.cancel();
    animations.current = [];
    const next = offset(viewport, scroller(viewport)) <= TOP_BUFFER;
    pinnedRef.current = next;
    setPinned(next);
    remember();
  }

  // A glide that stalls (interrupted without a scroll end) is judged where it stopped.
  // Each step of progress restarts the wait, so a slow glide is never cut short.
  function awaitGlide() {
    const started = glide.current;
    window.clearTimeout(glideTimer.current);

    glideTimer.current = window.setTimeout(() => {
      if (!started || glide.current !== started) return;
      glide.current = undefined;
      const viewport = viewportRef.current;
      if (viewport && activeRef.current) judge(viewport);
    }, GLIDE_STALL);
  }

  function scrollToTop() {
    window.clearTimeout(glideTimer.current);
    for (const animation of animations.current) animation.cancel();
    animations.current = [];
    pinnedRef.current = true;
    setPinned(true);
    const viewport = viewportRef.current;

    if (viewport) {
      const container = scroller(viewport);
      const target = container.scrollTop - offset(viewport, container);
      const distance = Math.abs(container.scrollTop - target);

      if (
        distance >= 1 &&
        typeof container.scrollTo === "function" &&
        !reducedMotion(container)
      ) {
        // Glide back so the reader sees where the latest activity sits.
        restoredScrollTop.current = undefined;
        const started = { target, distance, moved: false };
        glide.current = started;
        container.scrollTo({ top: target, behavior: "smooth" });
        awaitGlide();
      } else {
        // Replace any stale correction marker so only this jump's scroll event is ignored.
        glide.current = undefined;
        restoredScrollTop.current = distance >= 1 ? target : undefined;
        container.scrollTop = target;
      }

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
    // Task selection loads its event history asynchronously.
    if (!mounted.current && reading?.position && !events.length) return;
    // Measure without an in-flight transform before restoring the reading position.
    for (const animation of animations.current) animation.cancel();
    animations.current = [];
    const container = scroller(viewport);

    if (!mounted.current && reading?.position) {
      const saved = reading.position;
      pinnedRef.current = saved.pinned;
      setPinned(saved.pinned);

      if (!saved.pinned) {
        container.scrollTop = saved.top;

        const row = Array.from(
          viewport.querySelectorAll<HTMLElement>("[data-activity-id]"),
        ).find((element) => element.dataset.activityId === saved.anchor?.id);

        if (row && saved.anchor)
          container.scrollTop +=
            row.getBoundingClientRect().top -
            container.getBoundingClientRect().top -
            saved.anchor.top;
      }

      remember();
    }

    const previous = positions.current;
    const previousScrollTop = container.scrollTop;
    const previousOffset = offset(viewport, container);
    // A reader scroll can land before its scroll event; never pull it back to the top.
    // Other tabs can move a shared scroller, but the reader did not leave the latest activity.
    // A smooth return in flight is still pinned; finish it at once instead.
    const gliding = glide.current !== undefined;
    glide.current = undefined;

    if (
      mounted.current &&
      pinnedRef.current &&
      !revealed &&
      !gliding &&
      previousOffset > TOP_BUFFER
    ) {
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

    // Rows that changed while hidden appear in place rather than replaying motion.
    if (!reducedMotion(viewport) && mounted.current && !revealed) {
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
            { duration: MOTION.slow, easing: MOTION.easing },
          );

          if (animation) animations.current.push(animation);
        }
      }
    }

    mounted.current = true;
  }, [events, active, reading, remember]);

  // Scroll events do not bubble, so capture them from whichever element scrolls.
  useEffect(() => {
    const document = viewportRef.current?.ownerDocument;
    if (!document) return;

    const listener = (event: globalThis.Event) => {
      const viewport = viewportRef.current;
      // Skip unrelated scrollers before measuring styles up the tree.
      if (!viewport || !(event.target instanceof Node)) return;
      if (!event.target.contains(viewport)) return;
      if (event.target !== scroller(viewport)) return;

      // A glide that stops short of the top (the reader held it) is judged like any scroll.
      // Other scroll ends are ignored: they also follow our own anchor corrections.
      if (event.type === "scrollend") {
        if (!glide.current?.moved) return;
        glide.current = undefined;
      }

      onScroll();
    };

    document.addEventListener("scroll", listener, true);
    document.addEventListener("scrollend", listener, true);

    return () => {
      document.removeEventListener("scroll", listener, true);
      document.removeEventListener("scrollend", listener, true);
    };
  }, []);

  useLayoutEffect(
    () => () => {
      window.clearTimeout(glideTimer.current);
      for (const animation of animations.current) animation.cancel();
    },
    [],
  );

  return { viewportRef, pinned, scrollToTop };
}
