import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

import { scrollContainer } from "../../../../shared/utils/scroll-container";
import type { ReadingState } from "../../evidence/reading-state";

const END_SLACK_PX = 48;

/** Preserve the reader's place; follow incoming messages only at the end. */
export function useChatScroll(
  reading: ReadingState,
  active: boolean,
  ready: boolean,
) {
  const ref = useRef<HTMLDivElement>(null);
  const pinned = useRef(reading.position?.pinned ?? true);
  const restored = useRef(false);
  const activeRef = useRef(active);
  const wasActive = useRef(false);

  const remember = useCallback(
    (viewport: HTMLElement, container: HTMLElement) => {
      const top = container.getBoundingClientRect().top;

      const anchor = Array.from(
        viewport.querySelectorAll<HTMLElement>("[data-chat-item]"),
      ).find((element) => element.getBoundingClientRect().bottom > top);

      reading.position = {
        top: container.scrollTop,
        pinned: pinned.current,
        anchor: anchor && {
          id: anchor.dataset.chatItem!,
          top: anchor.getBoundingClientRect().top - top,
        },
      };
    },
    [reading],
  );

  const restore = useCallback(
    (viewport: HTMLElement, container: HTMLElement, preserveScroll = false) => {
      const saved = reading.position;

      // A reader scroll can precede its event; retain that movement during updates.
      const scrolled =
        preserveScroll && saved ? container.scrollTop - saved.top : 0;

      if (pinned.current && scrolled)
        pinned.current =
          container.scrollHeight -
            container.scrollTop -
            container.clientHeight <
          END_SLACK_PX;

      if (pinned.current) container.scrollTop = container.scrollHeight;
      else if (saved) {
        container.scrollTop = saved.top + scrolled;

        const anchor = Array.from(
          viewport.querySelectorAll<HTMLElement>("[data-chat-item]"),
        ).find((element) => element.dataset.chatItem === saved.anchor?.id);

        if (anchor && saved.anchor)
          container.scrollTop +=
            anchor.getBoundingClientRect().top -
            container.getBoundingClientRect().top -
            (saved.anchor.top - scrolled);
      }
    },
    [reading],
  );

  useLayoutEffect(() => {
    activeRef.current = active;
    const revealed = active && !wasActive.current;
    wasActive.current = active;
    const viewport = ref.current;
    if (!viewport || !active || !ready) return;
    const container = scrollContainer(viewport);
    // Correct the old anchor before remembering coordinates from the new content.
    restore(viewport, container, restored.current && !revealed);
    restored.current = true;
    remember(viewport, container);
  });

  useLayoutEffect(() => {
    const viewport = ref.current;
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

  useEffect(() => {
    const viewport = ref.current;
    if (!viewport) return;
    const document = viewport.ownerDocument;

    const onScroll = (event: Event) => {
      if (!activeRef.current || !restored.current) return;
      const container = scrollContainer(viewport);
      if (event.target !== container) return;

      pinned.current =
        container.scrollHeight - container.scrollTop - container.clientHeight <
        END_SLACK_PX;

      remember(viewport, container);
    };

    document.addEventListener("scroll", onScroll, true);

    return () => document.removeEventListener("scroll", onScroll, true);
  }, [reading, remember]);

  return ref;
}
