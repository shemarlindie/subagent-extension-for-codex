import { useCallback, useLayoutEffect, useRef, useState } from "react";

import { reducedMotion } from "../../../shared/components/motion/motion-utils";
import { blockUserScroll } from "../../../shared/utils/block-user-scroll";
import { scrollContainer } from "../../../shared/utils/scroll-container";
import { useContainerScroll } from "../../../shared/utils/use-container-scroll";
import { followEnd } from "./end-follower";
import type { ReadingState } from "./reading-state";
import { animateRows, measureRows, type RowPosition } from "./row-motion";
import {
  anchorable,
  canGlide,
  distanceFromEnd,
  end,
  END_SLACK_PX,
  findRow,
  followsEnd,
  type Glide,
  glideAhead,
  glideProgress,
  glideTarget,
  inView,
  jump,
  pendingScroll,
  restoreReadingAnchor,
} from "./scroll-geometry";

// How long a smooth return may go without progress before it counts as stopped.
const GLIDE_STALL_MS = 1500;

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
  /**
   * Slide moved rows to their new place and fade new rows in. `arrivals`
   * only fades new rows in, for views whose rows move on every streamed delta.
   */
  animateRows?: boolean | "arrivals";
  /** While at the end, glide to new content. Without it, the view jumps. */
  followSmoothly?: boolean;
  /**
   * A row to bring to the top once it renders. A new `request` asks again,
   * even for the same row.
   */
  focus?: ReadingFocus;
  /**
   * The rows render in a child, which runs the returned `syncAfterRender` in a
   * layout effect after each of its renders. The caller then need not render
   * when only the rows change.
   */
  syncInChild?: boolean;
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
  followSmoothly = false,
  focus,
  syncInChild = false,
}: ReadingScrollOptions) {
  const [local] = useState<ReadingState>(() => ({}));
  const reading = owned ?? local;
  const viewportRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(reading.position?.pinned ?? true);
  const [pinned, setPinned] = useState(pinnedRef.current);
  const [positionRestored, setPositionRestored] = useState(false);
  const restored = useRef(false);
  const activeRef = useRef(false);
  const correctedScrollTop = useRef<number | undefined>(undefined);
  const rows = useRef(new Map<string, RowPosition>());
  const animations = useRef<Animation[]>([]);
  const glide = useRef<Glide | undefined>(undefined);
  const glideTimer = useRef<number | undefined>(undefined);
  const releasedTop = useRef<number | undefined>(undefined);

  const endGlide = useCallback(() => {
    window.clearTimeout(glideTimer.current);
    glide.current?.follower?.cancel();
    glide.current = undefined;
  }, []);

  const pin = useCallback((next: boolean) => {
    if (next) releasedTop.current = undefined;
    pinnedRef.current = next;
    setPinned(next);
  }, []);

  // Arrival fades change only opacity, so measuring and scrolling leave them
  // playing.
  const stopAnimations = useCallback(() => {
    if (animate === "arrivals") return;
    for (const animation of animations.current) animation.cancel();
    animations.current = [];
  }, [animate]);

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
      const scrolled = preserveScroll
        ? pendingScroll(viewport, container, saved, pinnedRef.current)
        : 0;

      if (pinnedRef.current && scrolled) {
        pin(distanceFromEnd(container) <= END_SLACK_PX);
      }

      if (pinnedRef.current) {
        container.scrollTop = end(container);
      } else if (saved) {
        restoreReadingAnchor(
          viewport,
          container,
          itemAttribute,
          saved,
          rows.current,
          scrolled,
        );
      }

      // Ignore the scroll event this correction causes, so it cannot unpin
      // the reader or cancel row animations. A pending reader scroll still
      // needs its event judged.
      if (!scrolled && Math.abs(container.scrollTop - before) >= 1) {
        correctedScrollTop.current = container.scrollTop;
      }
    },
    [reading, itemAttribute, pin],
  );

  /**
   * Keeps a smooth scroll in progress through a content or size change,
   * returning whether one was. Its movement is not a reader scroll, so it must
   * not unpin. A change that only rerenders must not turn the glide into a
   * jump. If the timeline changed, a glide to the end keeps following with
   * `followSmoothly`. Otherwise it finishes at the new target at once.
   */
  const continueGlide = useCallback(
    (viewport: HTMLElement, container: HTMLElement) => {
      if (!glide.current) return false;
      const { row } = glide.current;

      const target =
        row && !row.isConnected
          ? glide.current.target
          : glideTarget(container, row);

      const changed = Math.abs(target - glide.current.target) >= 1;

      if (changed && !row && followSmoothly) {
        glide.current.target = target;
      } else if (changed) {
        endGlide();
        correctedScrollTop.current = target;
        container.scrollTop = target;
      }

      remember(viewport, container);

      return true;
    },
    [remember, followSmoothly, endGlide],
  );

  /**
   * Restores, follows or animates the rows after they render. The values it
   * reads change only when the caller renders, which renders the child too.
   */
  const syncAfterRender = () => {
    const revealed = active && !activeRef.current;
    activeRef.current = active;
    // A hidden view may share its scroller with the shown one.
    if (!active) endGlide();
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

    const previous = rows.current;
    const update = restored.current && !revealed;
    const gliding = continueGlide(viewport, container);

    if (!gliding && !(update && followLatest(viewport, container))) {
      // Correct the old anchor before remembering coordinates from the new content.
      restore(viewport, container, update);
      remember(viewport, container);
    }

    restored.current = true;

    // Rows that changed while hidden appear in place rather than replaying
    // motion. Rows moved by a glide stay still, while arrivals still fade in.
    if (
      animate &&
      update &&
      (!gliding || animate === "arrivals") &&
      !reducedMotion(viewport)
    ) {
      // Rows count as seen where a glide to the end will show them.
      const ahead = glideAhead(container, glide.current);

      animations.current = [
        ...animations.current.filter((a) => a.playState === "running"),
        ...animateRows(
          previous,
          rows.current,
          { top: ahead, bottom: ahead + container.clientHeight },
          animate === "arrivals",
        ),
      ];
    }
  };

  useLayoutEffect(() => {
    if (!syncInChild) syncAfterRender();
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
      pin(followsEnd(container, releasedTop.current));
      remember(viewport, container);
    },
    [pin, remember, stopAnimations],
  );

  const awaitGlide = useCallback(() => {
    const started = glide.current;
    window.clearTimeout(glideTimer.current);

    glideTimer.current = window.setTimeout(() => {
      if (!started || glide.current !== started) return;
      glide.current = undefined;
      const viewport = viewportRef.current;
      if (!viewport || !activeRef.current) return;
      judge(viewport, scrollContainer(viewport));
    }, GLIDE_STALL_MS);
  }, [judge]);

  const startGlide = useCallback(
    (container: HTMLElement, target: number, row?: HTMLElement) => {
      const distance = Math.abs(target - container.scrollTop);
      correctedScrollTop.current = undefined;
      glide.current = { target, distance, moved: false, row };

      if (row) {
        container.scrollTo({ top: target, behavior: "smooth" });
        awaitGlide();
      } else {
        glide.current.follower = followEnd(container, () => {
          endGlide();
          correctedScrollTop.current = jump(container, end(container));
          if (viewportRef.current) remember(viewportRef.current, container);
        });
      }
    },
    [awaitGlide, endGlide, remember],
  );

  /**
   * With `followSmoothly`, glide on to the end while pinned. Returns whether
   * that kept the reader at the end, so no restore is needed. The ordinary
   * restore judges a reader scroll still waiting for its event.
   */
  const followLatest = useCallback(
    (viewport: HTMLElement, container: HTMLElement) => {
      if (!followSmoothly || !pinnedRef.current || !canGlide(container)) {
        return false;
      }

      if (reading.position?.top !== container.scrollTop) return false;

      if (distanceFromEnd(container) >= 1) {
        startGlide(container, end(container));
      }

      remember(viewport, container);

      return true;
    },
    [followSmoothly, reading, startGlide, remember],
  );

  const reconcileAfterContentChange = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || !activeRef.current || !restored.current) return;

    const container = scrollContainer(viewport);
    if (continueGlide(viewport, container)) return;
    if (followLatest(viewport, container)) return;
    restore(viewport, container, true);
    remember(viewport, container);
  }, [continueGlide, followLatest, remember, restore]);

  const focused = useRef<number | undefined>(undefined);
  const focusId = focus?.id;
  const focusRequest = focus?.request;
  const focusReveal = focus?.reveal;

  // After the restore above, so the requested row wins over the saved place.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (focusId === undefined || focused.current === focusRequest) return;
    if (!viewport || !active || !ready) return;

    const element = findRow(viewport, itemAttribute, focusId);
    if (!element) return;
    focused.current = focusRequest;
    const container = scrollContainer(viewport);
    if (focusReveal && inView(container, element)) return;

    endGlide();
    stopAnimations();
    const before = container.scrollTop;
    const target = glideTarget(container, element);

    // Reading from the row unpins, unless the row already sits at the end.
    pin(end(container) - target <= END_SLACK_PX);

    // Revealing a row the reader asked for glides to it; opening at one jumps.
    if (focusReveal && Math.abs(target - before) >= 1 && canGlide(container)) {
      startGlide(container, target, element);
    } else {
      correctedScrollTop.current = jump(container, target);
    }

    remember(viewport, container);
  }, [
    focusId,
    focusRequest,
    focusReveal,
    active,
    ready,
    itemAttribute,
    endGlide,
    pin,
    remember,
    stopAnimations,
    startGlide,
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

      reconcileAfterContentChange();
    });

    observer.observe(viewport);

    return () => observer.disconnect();
  }, [reconcileAfterContentChange, blockScrollWhileLoading]);

  const stopFollowing = () => {
    const viewport = viewportRef.current;
    if (!viewport || !activeRef.current || !restored.current) return;
    if (!pinnedRef.current && !glide.current) return;
    const container = scrollContainer(viewport);
    if (end(container) === 0) return;
    const top = container.scrollTop;
    // Cancel the native glide before a resize can restart it over the gesture.
    if (glide.current) container.scrollTop = top;
    endGlide();
    correctedScrollTop.current = top;
    pin(false);
    releasedTop.current = top;
    remember(viewport, container);
  };

  useContainerScroll(
    viewportRef,
    (event) => {
      const viewport = viewportRef.current;

      if (event.type === "scrollend") {
        if (!glide.current?.moved) return;
        glide.current = undefined;
      }

      if (!viewport || !activeRef.current || !restored.current) return;
      const container = scrollContainer(viewport);
      const top = container.scrollTop;
      const corrected = correctedScrollTop.current;
      correctedScrollTop.current = undefined;

      // The browser also emits scroll after our own anchor correction.
      if (corrected !== undefined && Math.abs(top - corrected) < 1) return;

      const follower = glide.current?.follower;
      if (follower?.holds(top, viewport)) return;
      if (follower) endGlide();

      // A smooth return stays pinned while it closes in. Moving away means the
      // reader took over, so restore ordinary reading-position behavior.
      if (glide.current) {
        const progress = glideProgress(glide.current, top);

        if (progress === "arrived") {
          glide.current = undefined;
          remember(viewport, container);

          return;
        }

        if (progress === "closer") awaitGlide();
        if (progress !== "left") return;
        glide.current = undefined;
      }

      judge(viewport, container);
    },
    stopFollowing,
  );

  const resumeFollowing = useCallback(() => {
    // Without a glide, a pinned view leaves the end through layout, such as a
    // collapsing composer clamping it, or a reader scroll within the end slack.
    // Jump back, since a glide would fight layout that is still animating.
    const smooth = !pinnedRef.current || glide.current !== undefined;
    endGlide();
    stopAnimations();
    const viewport = viewportRef.current;
    if (!viewport) return;
    const container = scrollContainer(viewport);
    pin(true);

    if (smooth && distanceFromEnd(container) >= 1 && canGlide(container)) {
      startGlide(container, end(container));
    } else {
      correctedScrollTop.current = jump(container, end(container));
    }

    remember(viewport, container);
  }, [endGlide, pin, startGlide, remember, stopAnimations]);

  const scrollToLatest = useCallback(() => {
    resumeFollowing();
    viewportRef.current?.focus({ preventScroll: true });
  }, [resumeFollowing]);

  useLayoutEffect(
    () => () => {
      endGlide();
      stopAnimations();
    },
    [endGlide, stopAnimations],
  );

  return {
    viewportRef,
    pinned,
    positionRestored: !reportPositionRestored || positionRestored,
    reconcileAfterContentChange,
    resumeFollowing,
    scrollToLatest,
    syncAfterRender,
  };
}
