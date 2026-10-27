import { type RefObject, useEffect, useEffectEvent } from "react";

import { scrollContainer } from "./scroll-container";

/**
 * Calls `onScroll` for each `scroll` and `scrollend` event of the container
 * that scrolls `viewportRef`, which may be the view itself or an ancestor.
 * `onScrollAway` runs before an upward reading gesture moves the container.
 */
export function useContainerScroll(
  viewportRef: RefObject<HTMLElement | null>,
  onScroll: (event: Event) => void,
  onScrollAway?: () => void,
) {
  const handle = useEffectEvent(onScroll);
  const away = useEffectEvent(() => onScrollAway?.());

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const document = viewport.ownerDocument;

    const listener = (event: Event) => {
      if (event.target === scrollContainer(viewport)) handle(event);
    };

    const within = (event: Event) =>
      event.target instanceof Node &&
      (viewport.contains(event.target) ||
        event.target === scrollContainer(viewport));

    // Nested scrollers keep a gesture until their boundary allows chaining.
    const reachesContainer = (event: Event) => {
      if (event.defaultPrevented || !within(event)) return false;
      const container = scrollContainer(viewport);
      let target = event.target instanceof Element ? event.target : null;

      while (target && target !== container) {
        const style = getComputedStyle(target);

        if (
          /auto|scroll/.test(style.overflowY) &&
          (target.scrollTop > 0 ||
            /contain|none/.test(style.overscrollBehaviorY))
        ) {
          return false;
        }

        target = target.parentElement;
      }

      return true;
    };

    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && event.deltaY < 0 && reachesContainer(event)) away();
    };

    let touchY: number | undefined;

    const touchStart = (event: TouchEvent) => {
      touchY =
        within(event) && event.touches.length === 1
          ? event.touches[0]?.clientY
          : undefined;
    };

    const touchMove = (event: TouchEvent) => {
      if (touchY === undefined || !within(event)) return;

      const next =
        event.touches.length === 1 ? event.touches[0]?.clientY : undefined;

      if (next !== undefined && next > touchY && reachesContainer(event)) {
        away();
      }

      touchY = next;
    };

    const keyDown = (event: KeyboardEvent) => {
      const target = event.target;

      if (
        !reachesContainer(event) ||
        (target instanceof HTMLElement &&
          (target.isContentEditable ||
            /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)))
      ) {
        return;
      }

      if (
        ["ArrowUp", "PageUp", "Home"].includes(event.key) ||
        (event.key === " " && event.shiftKey)
      ) {
        away();
      }
    };

    document.addEventListener("scroll", listener, true);
    document.addEventListener("scrollend", listener, true);
    document.addEventListener("wheel", wheel, { capture: true, passive: true });

    document.addEventListener("touchstart", touchStart, {
      capture: true,
      passive: true,
    });

    document.addEventListener("touchmove", touchMove, {
      capture: true,
      passive: true,
    });

    document.addEventListener("keydown", keyDown);

    return () => {
      document.removeEventListener("scroll", listener, true);
      document.removeEventListener("scrollend", listener, true);
      document.removeEventListener("wheel", wheel, true);
      document.removeEventListener("touchstart", touchStart, true);
      document.removeEventListener("touchmove", touchMove, true);
      document.removeEventListener("keydown", keyDown);
    };
  }, [viewportRef]);
}
