import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { reducedMotion } from "../../../shared/components/motion/motion-utils";
import { scrollContainer } from "../../../shared/utils/scroll-container";
import type { ReadingState } from "./reading-state";
import { animateRows, measureRows, type RowPosition } from "./row-motion";

const END_SLACK_PX = 48;
// How long a smooth return may go without progress before it counts as stopped.
const GLIDE_STALL_MS = 1500;

function end(container: HTMLElement) {
  return Math.max(0, container.scrollHeight - container.clientHeight);
}

function distanceFromEnd(container: HTMLElement) {
  return end(container) - container.scrollTop;
}

export type ReadingScrollOptions = {
  /** Where the reader was; kept by the owner so it survives remounts. */
  reading?: ReadingState;
  /** The view is shown; a hidden tab has no layout to measure. */
  active: boolean;
  /** Content has loaded, so a saved position can be restored against it. */
  ready: boolean;
  /** The data attribute that identifies each row, such as `data-chat-item`. */
  itemAttribute: string;
  /** Slide moved rows to their new place and fade new rows in. */
  animateRows?: boolean;
  /**
   * A row to bring to the top once it renders. A new `request` asks again,
   * even for the same row.
   */
  focus?: ReadingFocus;
};

export type ReadingFocus = { id: string; request: number };

/**
 * Keep an oldest-first timeline at its latest row while the reader is there,
 * and preserve the reader's place while they read history.
 */
export function useReadingScroll({
  reading: owned,
  active,
  ready,
  itemAttribute,
  animateRows: animate = false,
  focus,
}: ReadingScrollOptions) {
  const [local] = useState<ReadingState>(() => ({}));
  const reading = owned ?? local;
  const viewportRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(reading.position?.pinned ?? true);
  const [pinned, setPinned] = useState(pinnedRef.current);
  const restored = useRef(false);
  const activeRef = useRef(active);
  const wasActive = useRef(false);
  const correctedScrollTop = useRef<number | undefined>(undefined);
  const rows = useRef(new Map<string, RowPosition>());
  const animations = useRef<Animation[]>([]);

  const glide = useRef<
    { target: number; distance: number; moved: boolean } | undefined
  >(undefined);

  const glideTimer = useRef<number | undefined>(undefined);

  const stopAnimations = useCallback(() => {
    for (const animation of animations.current) animation.cancel();
    animations.current = [];
  }, []);

  const remember = useCallback(
    (viewport: HTMLElement, container: HTMLElement) => {
      rows.current = measureRows(viewport, container, itemAttribute);

      const anchor = [...rows.current].find(
        ([, position]) => position.bottom > 0,
      );

      reading.position = {
        top: container.scrollTop,
        pinned: pinnedRef.current,
        anchor: anchor && { id: anchor[0], top: anchor[1].top },
      };
    },
    [reading, itemAttribute],
  );

  const restore = useCallback(
    (viewport: HTMLElement, container: HTMLElement, preserveScroll = false) => {
      const saved = reading.position;
      const before = container.scrollTop;

      // A reader scroll can precede its event; retain that movement during updates.
      const scrolled =
        preserveScroll && saved ? container.scrollTop - saved.top : 0;

      if (pinnedRef.current && scrolled) {
        const nextPinned = distanceFromEnd(container) <= END_SLACK_PX;
        pinnedRef.current = nextPinned;
        setPinned(nextPinned);
      }

      if (pinnedRef.current) container.scrollTop = end(container);
      else if (saved) {
        container.scrollTop = saved.top + scrolled;

        const element =
          saved.anchor &&
          Array.from(
            viewport.querySelectorAll<HTMLElement>(`[${itemAttribute}]`),
          ).find(
            (element) =>
              element.getAttribute(itemAttribute) === saved.anchor!.id,
          );

        // Fall back to another visible row when a trimmed history drops the anchor.
        const anchor = element
          ? { element, top: saved.anchor!.top }
          : [...rows.current.values()].find(
              (position) => position.bottom > 0 && position.element.isConnected,
            );

        if (anchor)
          container.scrollTop +=
            anchor.element.getBoundingClientRect().top -
            container.getBoundingClientRect().top -
            (anchor.top - scrolled);
      }

      // Ignore the scroll event this correction causes, so it cannot unpin
      // the reader or cancel row animations. A pending reader scroll still
      // needs its event judged.
      if (!scrolled && Math.abs(container.scrollTop - before) >= 1)
        correctedScrollTop.current = container.scrollTop;
    },
    [reading, itemAttribute],
  );

  useLayoutEffect(() => {
    activeRef.current = active;
    const revealed = active && !wasActive.current;
    wasActive.current = active;
    const viewport = viewportRef.current;
    if (!viewport || !active || !ready) return;
    const container = scrollContainer(viewport);
    // Measure without an in-flight transform.
    stopAnimations();

    if (glide.current) {
      const target = end(container);

      // A render caused by hiding the button must not turn a smooth return into
      // a jump. If the timeline grew, finish at the new live edge instead.
      if (Math.abs(target - glide.current.target) >= 1) {
        window.clearTimeout(glideTimer.current);
        glide.current = undefined;
        correctedScrollTop.current = target;
        container.scrollTop = target;
      }

      restored.current = true;
      remember(viewport, container);

      return;
    }

    const previous = rows.current;
    const settled = restored.current;
    // Correct the old anchor before remembering coordinates from the new content.
    restore(viewport, container, settled && !revealed);
    restored.current = true;
    remember(viewport, container);

    // Rows that changed while hidden appear in place rather than replaying motion.
    if (animate && settled && !revealed && !reducedMotion(viewport))
      animations.current = animateRows(
        previous,
        rows.current,
        container.clientHeight,
      );
  });

  const focused = useRef<number | undefined>(undefined),
    focusId = focus?.id,
    focusRequest = focus?.request;

  // After the restore above, so the requested row wins over the saved place.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (focusId === undefined || focused.current === focusRequest) return;
    if (!viewport || !active || !ready) return;

    const element = Array.from(
      viewport.querySelectorAll<HTMLElement>(`[${itemAttribute}]`),
    ).find((element) => element.getAttribute(itemAttribute) === focusId);

    if (!element) return;
    focused.current = focusRequest;
    const container = scrollContainer(viewport);
    window.clearTimeout(glideTimer.current);
    glide.current = undefined;
    stopAnimations();
    const before = container.scrollTop;

    container.scrollTop +=
      element.getBoundingClientRect().top -
      container.getBoundingClientRect().top;

    if (Math.abs(container.scrollTop - before) >= 1)
      correctedScrollTop.current = container.scrollTop;

    // Reading from the row unpins, unless the row already sits at the end.
    const next = distanceFromEnd(container) <= END_SLACK_PX;
    pinnedRef.current = next;
    setPinned(next);
    remember(viewport, container);
  }, [
    focusId,
    focusRequest,
    active,
    ready,
    itemAttribute,
    remember,
    stopAnimations,
  ]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      if (!activeRef.current || !restored.current) return;
      const container = scrollContainer(viewport);
      restore(viewport, container, true);
      remember(viewport, container);
    });

    observer.observe(viewport);

    return () => observer.disconnect();
  }, [reading, restore, remember]);

  const judge = useCallback(
    (viewport: HTMLElement, container: HTMLElement) => {
      stopAnimations();
      const next = distanceFromEnd(container) <= END_SLACK_PX;
      pinnedRef.current = next;
      setPinned(next);
      remember(viewport, container);
    },
    [remember, stopAnimations],
  );

  const awaitGlide = useCallback(() => {
    const started = glide.current;
    window.clearTimeout(glideTimer.current);

    glideTimer.current = window.setTimeout(() => {
      if (!started || glide.current !== started) return;
      glide.current = undefined;
      const viewport = viewportRef.current;
      if (viewport && activeRef.current)
        judge(viewport, scrollContainer(viewport));
    }, GLIDE_STALL_MS);
  }, [judge]);

  const onScroll = useEffectEvent(() => {
    const viewport = viewportRef.current;
    if (!viewport || !activeRef.current || !restored.current) return;
    const container = scrollContainer(viewport);
    const top = container.scrollTop;
    const corrected = correctedScrollTop.current;
    correctedScrollTop.current = undefined;

    // The browser also emits scroll after our own anchor correction.
    if (corrected !== undefined && Math.abs(top - corrected) < 1) return;

    // A smooth return stays pinned while it closes in. Moving away means the
    // reader took over, so restore ordinary reading-position behavior.
    if (glide.current) {
      const distance = Math.abs(top - glide.current.target);

      if (distance < 1) {
        glide.current = undefined;
        remember(viewport, container);

        return;
      }

      if (distance <= glide.current.distance + 1) {
        if (distance < glide.current.distance - 1) {
          glide.current.moved = true;
          awaitGlide();
        }

        glide.current.distance = distance;

        return;
      }

      glide.current = undefined;
    }

    judge(viewport, container);
  });

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const document = viewport.ownerDocument;

    const listener = (event: Event) => {
      const container = scrollContainer(viewport);
      if (event.target !== container) return;

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

  const scrollToLatest = useCallback(() => {
    window.clearTimeout(glideTimer.current);
    stopAnimations();
    const viewport = viewportRef.current;
    if (!viewport) return;
    const container = scrollContainer(viewport);
    const target = end(container);
    const distance = Math.abs(container.scrollTop - target);
    pinnedRef.current = true;
    setPinned(true);

    if (
      distance >= 1 &&
      typeof container.scrollTo === "function" &&
      !reducedMotion(container)
    ) {
      correctedScrollTop.current = undefined;
      glide.current = { target, distance, moved: false };
      container.scrollTo({ top: target, behavior: "smooth" });
      awaitGlide();
    } else {
      glide.current = undefined;
      correctedScrollTop.current = distance >= 1 ? target : undefined;
      container.scrollTop = target;
    }

    viewport.focus({ preventScroll: true });
    remember(viewport, container);
  }, [awaitGlide, remember, stopAnimations]);

  useLayoutEffect(
    () => () => {
      window.clearTimeout(glideTimer.current);
      stopAnimations();
    },
    [stopAnimations],
  );

  return { viewportRef, pinned, scrollToLatest };
}
