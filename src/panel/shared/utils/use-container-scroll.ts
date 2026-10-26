import { type RefObject, useEffect, useEffectEvent } from "react";

import { scrollContainer } from "./scroll-container";

/**
 * Calls `onScroll` for each `scroll` and `scrollend` event of the container
 * that scrolls `viewportRef`, which may be the view itself or an ancestor.
 */
export function useContainerScroll(
  viewportRef: RefObject<HTMLElement | null>,
  onScroll: (event: Event) => void,
) {
  const handle = useEffectEvent(onScroll);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const document = viewport.ownerDocument;

    const listener = (event: Event) => {
      if (event.target === scrollContainer(viewport)) handle(event);
    };

    document.addEventListener("scroll", listener, true);
    document.addEventListener("scrollend", listener, true);

    return () => {
      document.removeEventListener("scroll", listener, true);
      document.removeEventListener("scrollend", listener, true);
    };
  }, [viewportRef]);
}
