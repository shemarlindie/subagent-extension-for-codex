import { useCallback, useLayoutEffect, useRef, useState } from "react";

import { reducedMotion } from "../../shared/components/motion/motion-utils";
import { scrollContainer } from "../../shared/utils/scroll-container";
import {
  type ChangesReading,
  measurePosition,
  restorePosition,
} from "./changes-reading";

const TOP_SLACK_PX = 48;

/**
 * Returns the reader to their place in a task's changes when the tab shows
 * again, and keeps that place current while they scroll.
 */
export function useChangesScroll(
  reading: ChangesReading,
  ready: boolean,
  hasFiles = true,
) {
  const viewportRef = useRef<HTMLDivElement>(null);
  // The reader scrolled since the tab showed, so their place is current.
  const scrolled = useRef(false);

  const [atTop, setAtTop] = useState(true);
  const [activePath, setActivePath] = useState(reading.position?.anchor?.path);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    // Wait for the files: restoring against the loading note would lose the place.
    if (!viewport || !ready) return;

    if (!hasFiles) {
      // An old file offset can be clamped when the tall loading view disappears.
      // Empty results have no file position to restore, so keep the message at top.
      reading.position = undefined;
      scrolled.current = false;
      scrollContainer(viewport).scrollTop = 0;
      setAtTop(true);
      setActivePath(undefined);

      return;
    }

    // The scroll a restore causes, so it isn't mistaken for the reader's.
    let corrected: { container: HTMLElement; top: number } | undefined;

    // A task that just opened can briefly lay out with another scroller, so
    // restore again as the layout settles, until the reader scrolls.
    const restore = () => {
      const container = scrollContainer(viewport);

      if (reading.position && container.scrollHeight > container.clientHeight) {
        restorePosition(viewport, container, reading.position);
        corrected = { container, top: container.scrollTop };
      }

      setActivePath(measurePosition(viewport, container).anchor?.path);
      setAtTop(container.scrollTop <= TOP_SLACK_PX);
    };

    const observer =
      scrolled.current || typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(restore);

    // The panel resizes when it becomes the scroller; the files as they render.
    if (viewport.parentElement) observer?.observe(viewport.parentElement);
    observer?.observe(viewport);
    if (!scrolled.current) restore();

    // The scroller depends on the layout, so find it per event. Scroll events
    // don't bubble; capture sees them on the way down.
    const onScroll = (event: Event) => {
      const { target } = event;
      // Skip scrollers elsewhere, such as a code block or the tab list.
      if (!(target instanceof Node) || !target.contains(viewport)) return;
      const container = scrollContainer(viewport);
      if (target !== container) return;
      setAtTop(container.scrollTop <= TOP_SLACK_PX);

      // The first event after a restore is the restore's own; consume it.
      const own =
        corrected?.container === container &&
        Math.abs(container.scrollTop - corrected.top) < 1;

      corrected = undefined;
      if (own) return;

      scrolled.current = true;
      observer?.disconnect();
      reading.position = measurePosition(viewport, container);
      setActivePath(reading.position.anchor?.path);
    };

    const { ownerDocument } = viewport;

    ownerDocument.addEventListener("scroll", onScroll, {
      capture: true,
      passive: true,
    });

    return () => {
      observer?.disconnect();
      ownerDocument.removeEventListener("scroll", onScroll, { capture: true });
    };
  }, [hasFiles, reading, ready]);

  const scrollToTop = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const container = scrollContainer(viewport);

    if (
      container.scrollTop > 0 &&
      typeof container.scrollTo === "function" &&
      !reducedMotion(container)
    ) {
      container.scrollTo({ top: 0, behavior: "smooth" });

      return;
    }

    container.scrollTop = 0;
    reading.position = measurePosition(viewport, container);
    setActivePath(reading.position.anchor?.path);
    setAtTop(true);
  }, [reading]);

  return { viewportRef, scrolled: !atTop, scrollToTop, activePath };
}
