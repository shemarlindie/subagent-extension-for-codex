import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { reducedMotion } from "../../../shared/components/motion/motion-utils";
import { blockUserScroll } from "../../../shared/utils/block-user-scroll";
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

/** The scroll position that puts `row` at the top, or the end without one. */
function glideTarget(container: HTMLElement, row?: HTMLElement) {
  if (!row) return end(container);

  const top =
    container.scrollTop +
    row.getBoundingClientRect().top -
    container.getBoundingClientRect().top;

  return Math.min(end(container), Math.max(0, top));
}

/**
 * A visible row that can hold the reader's place. A marker that moves, such
 * as Chat's New divider, opts out with `overflow-anchor: none`.
 */
function anchorable(position: RowPosition) {
  return (
    position.bottom > 0 &&
    getComputedStyle(position.element).overflowAnchor !== "none"
  );
}

function canGlide(container: HTMLElement) {
  return typeof container.scrollTo === "function" && !reducedMotion(container);
}

export type ReadingScrollOptions = {
  /** Where the reader was; kept by the owner so it survives remounts. */
  reading?: ReadingState;
  /** The view is shown; a hidden tab has no layout to measure. */
  active: boolean;
  /** Content has loaded, so a saved position can be restored against it. */
  ready: boolean;
  /** Prevent user scrolling while this view shows its loading placeholder. */
  blockScrollWhileLoading?: boolean;
  /** Report when the active content's saved position has been restored. */
  reportPositionRestored?: boolean;
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

type ReadingFocus = {
  id: string;
  request: number;
  /** Scroll only when the row is out of view, rather than to the top. */
  reveal?: boolean;
};

/**
 * Keep an oldest-first timeline at its latest row while the reader is there,
 * and preserve the reader's place while they read history.
 */
export function useReadingScroll({
  reading: owned,
  active,
  ready,
  blockScrollWhileLoading = false,
  reportPositionRestored = false,
  itemAttribute,
  animateRows: animate = false,
  focus,
}: ReadingScrollOptions) {
  const [local] = useState<ReadingState>(() => ({}));
  const reading = owned ?? local;
  const viewportRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(reading.position?.pinned ?? true);
  const [pinned, setPinned] = useState(pinnedRef.current);
  const [positionRestored, setPositionRestored] = useState(false);
  const restored = useRef(false);
  const activeRef = useRef(active);
  const wasActive = useRef(false);
  const correctedScrollTop = useRef<number | undefined>(undefined);
  const rows = useRef(new Map<string, RowPosition>());
  const animations = useRef<Animation[]>([]);

  // A smooth scroll in progress: to the latest row, or to a focused `row`.
  const glide = useRef<
    | { target: number; distance: number; moved: boolean; row?: HTMLElement }
    | undefined
  >(undefined);

  const glideTimer = useRef<number | undefined>(undefined);

  const stopAnimations = useCallback(() => {
    for (const animation of animations.current) animation.cancel();
    animations.current = [];
  }, []);

  const remember = useCallback(
    (viewport: HTMLElement, container: HTMLElement) => {
      rows.current = measureRows(viewport, container, itemAttribute);

      const anchor = [...rows.current].find(([, position]) =>
        anchorable(position),
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

      if (pinnedRef.current) {
        container.scrollTop = end(container);
      } else if (saved) {
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
              (position) =>
                anchorable(position) && position.element.isConnected,
            );

        if (anchor) {
          container.scrollTop +=
            anchor.element.getBoundingClientRect().top -
            container.getBoundingClientRect().top -
            (anchor.top - scrolled);
        }
      }

      // Ignore the scroll event this correction causes, so it cannot unpin
      // the reader or cancel row animations. A pending reader scroll still
      // needs its event judged.
      if (!scrolled && Math.abs(container.scrollTop - before) >= 1) {
        correctedScrollTop.current = container.scrollTop;
      }
    },
    [reading, itemAttribute],
  );

  /**
   * Keeps a smooth scroll in progress through a content or size change,
   * returning whether one was. Its movement is not a reader scroll, so it must
   * not unpin. A change that only rerenders must not turn the glide into a
   * jump. If the timeline changed, finish at the new target instead.
   */
  const continueGlide = useCallback(
    (viewport: HTMLElement, container: HTMLElement) => {
      if (!glide.current) return false;
      const { row } = glide.current;

      const target =
        row && !row.isConnected
          ? glide.current.target
          : glideTarget(container, row);

      if (Math.abs(target - glide.current.target) >= 1) {
        window.clearTimeout(glideTimer.current);
        glide.current = undefined;
        correctedScrollTop.current = target;
        container.scrollTop = target;
      }

      remember(viewport, container);

      return true;
    },
    [remember],
  );

  const reconcileAfterContentChange = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || !activeRef.current || !restored.current) return;

    const container = scrollContainer(viewport);
    if (continueGlide(viewport, container)) return;
    restore(viewport, container, true);
    remember(viewport, container);
  }, [continueGlide, remember, restore]);

  useLayoutEffect(() => {
    activeRef.current = active;
    const revealed = active && !wasActive.current;
    wasActive.current = active;
    const viewport = viewportRef.current;

    if (!ready) {
      // A resize while loading must not restore the previous task's position
      // over the placeholder or the position captured for the next reveal.
      restored.current = false;
      if (!viewport || !active) return;

      // Task details can add pending input after the placeholder first renders.
      // Keep a pinned chat at its latest edge as that loading layout changes.
      if (blockScrollWhileLoading && pinnedRef.current) {
        const container = scrollContainer(viewport);
        container.scrollTop = end(container);
      }

      return;
    }

    if (!viewport || !active) return;

    const container = scrollContainer(viewport);
    // Measure without an in-flight transform.
    stopAnimations();

    if (continueGlide(viewport, container)) {
      restored.current = true;

      return;
    }

    const previous = rows.current;
    const settled = restored.current;
    // Correct the old anchor before remembering coordinates from the new content.
    restore(viewport, container, settled && !revealed);
    restored.current = true;
    remember(viewport, container);

    // Rows that changed while hidden appear in place rather than replaying motion.
    if (animate && settled && !revealed && !reducedMotion(viewport)) {
      animations.current = animateRows(
        previous,
        rows.current,
        container.clientHeight,
      );
    }
  });

  // Runs after the restore above. The chat swap uses this to wait until its
  // saved position is in place before starting the cross-fade.
  useLayoutEffect(() => {
    if (!reportPositionRestored) return;
    if (!ready) setPositionRestored(false);
    else if (active && viewportRef.current) setPositionRestored(true);
  }, [active, ready, reportPositionRestored]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !active || ready || !blockScrollWhileLoading) return;

    return blockUserScroll(viewport);
  }, [active, blockScrollWhileLoading, ready]);

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

      if (viewport && activeRef.current) {
        judge(viewport, scrollContainer(viewport));
      }
    }, GLIDE_STALL_MS);
  }, [judge]);

  const focused = useRef<number | undefined>(undefined),
    focusId = focus?.id,
    focusRequest = focus?.request,
    focusReveal = focus?.reveal;

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
    const row = element.getBoundingClientRect();
    const frame = container.getBoundingClientRect();

    if (focusReveal && row.top >= frame.top && row.bottom <= frame.bottom) {
      return;
    }

    window.clearTimeout(glideTimer.current);
    glide.current = undefined;
    stopAnimations();
    const before = container.scrollTop;
    const target = glideTarget(container, element);
    const distance = Math.abs(target - before);

    // Reading from the row unpins, unless the row already sits at the end.
    const next = end(container) - target <= END_SLACK_PX;
    pinnedRef.current = next;
    setPinned(next);

    // Revealing a row the reader asked for glides to it; opening at one jumps.
    if (focusReveal && distance >= 1 && canGlide(container)) {
      correctedScrollTop.current = undefined;
      glide.current = { target, distance, moved: false, row: element };
      container.scrollTo({ top: target, behavior: "smooth" });
      awaitGlide();
    } else {
      container.scrollTop = target;

      if (Math.abs(container.scrollTop - before) >= 1) {
        correctedScrollTop.current = container.scrollTop;
      }
    }

    remember(viewport, container);
  }, [
    focusId,
    focusRequest,
    focusReveal,
    active,
    ready,
    itemAttribute,
    remember,
    stopAnimations,
    awaitGlide,
  ]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      if (!activeRef.current) return;
      const container = scrollContainer(viewport);

      // While Chat is loading, task-specific controls can still arrive and
      // resize the viewport. Re-anchor the placeholder without restoring an
      // old task's reading position over it.
      if (!restored.current) {
        if (blockScrollWhileLoading && pinnedRef.current) {
          container.scrollTop = end(container);
        }

        return;
      }

      if (continueGlide(viewport, container)) return;
      restore(viewport, container, true);
      remember(viewport, container);
    });

    observer.observe(viewport);

    return () => observer.disconnect();
  }, [reading, restore, remember, continueGlide, blockScrollWhileLoading]);

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

    if (distance >= 1 && canGlide(container)) {
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

  return {
    viewportRef,
    pinned,
    positionRestored: !reportPositionRestored || positionRestored,
    reconcileAfterContentChange,
    scrollToLatest,
  };
}
