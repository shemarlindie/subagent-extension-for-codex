import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { reducedMotion } from "../../../../shared/components/motion/motion-utils";
import { scrollContainer } from "../../../../shared/utils/scroll-container";
import type { ReadingState } from "../../evidence/reading-state";

const END_SLACK_PX = 48;
// How long a smooth return may go without progress before it counts as stopped.
const GLIDE_STALL_MS = 1500;

function end(container: HTMLElement) {
  return Math.max(0, container.scrollHeight - container.clientHeight);
}

function distanceFromEnd(container: HTMLElement) {
  return end(container) - container.scrollTop;
}

/** Preserve the reader's place; follow incoming messages only at the end. */
export function useChatScroll(
  reading: ReadingState,
  active: boolean,
  ready: boolean,
) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(reading.position?.pinned ?? true);
  const [pinned, setPinned] = useState(pinnedRef.current);
  const restored = useRef(false);
  const activeRef = useRef(active);
  const wasActive = useRef(false);
  const correctedScrollTop = useRef<number | undefined>(undefined);

  const glide = useRef<
    { target: number; distance: number; moved: boolean } | undefined
  >(undefined);

  const glideTimer = useRef<number | undefined>(undefined);

  const remember = useCallback(
    (viewport: HTMLElement, container: HTMLElement) => {
      const top = container.getBoundingClientRect().top;

      const anchor = Array.from(
        viewport.querySelectorAll<HTMLElement>("[data-chat-item]"),
      ).find((element) => element.getBoundingClientRect().bottom > top);

      reading.position = {
        top: container.scrollTop,
        pinned: pinnedRef.current,
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

      if (pinnedRef.current && scrolled) {
        const nextPinned = distanceFromEnd(container) <= END_SLACK_PX;
        pinnedRef.current = nextPinned;
        setPinned(nextPinned);
      }

      if (pinnedRef.current) container.scrollTop = end(container);
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
    const viewport = viewportRef.current;
    if (!viewport || !active || !ready) return;
    const container = scrollContainer(viewport);

    if (glide.current) {
      const target = end(container);

      // A render caused by hiding the button must not turn a smooth return into
      // a jump. If the conversation grew, finish at the new live edge instead.
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

    // Correct the old anchor before remembering coordinates from the new content.
    restore(viewport, container, restored.current && !revealed);
    restored.current = true;
    remember(viewport, container);
  });

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
      const next = distanceFromEnd(container) <= END_SLACK_PX;
      pinnedRef.current = next;
      setPinned(next);
      remember(viewport, container);
    },
    [remember],
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
  }, [awaitGlide, remember]);

  useLayoutEffect(
    () => () => {
      window.clearTimeout(glideTimer.current);
    },
    [],
  );

  return { viewportRef, pinned, scrollToLatest };
}
