import { type RefObject, useCallback, useLayoutEffect, useRef } from "react";

import { useController } from "../../../app/state/controller-context";
import {
  canAnimate,
  MOTION,
} from "../../../shared/components/motion/motion-utils";

/** Grows an element in from nothing, fading it in as it opens. */
function reveal(element: HTMLElement) {
  // Layout can land between pixels; rounding the endpoint makes it snap when
  // the animation releases the element back to its natural height.
  const height = element.getBoundingClientRect().height;
  const style = getComputedStyle(element);

  return element.animate(
    [
      {
        height: "0px",
        marginTop: "0px",
        marginBottom: "0px",
        opacity: 0,
        overflow: "hidden",
      },
      {
        height: `${height}px`,
        marginTop: style.marginTop,
        marginBottom: style.marginBottom,
        opacity: 1,
        overflow: "hidden",
      },
    ],
    { duration: MOTION.slow, easing: MOTION.easing },
  );
}

/**
 * When a task opens straight from the new-task composer, the task header and
 * tabs ease in above Chat while its composer settles from the composer's
 * taller box. The composer's bottom edge stays put throughout.
 */
export function useArrivalMotion(
  view: RefObject<HTMLElement | null>,
  taskId: string | undefined,
  composing = false,
) {
  const { session } = useController();
  const draftHeight = useRef<number | undefined>(undefined);

  const newTaskViewRef = useCallback((element: HTMLDivElement | null) => {
    if (!element) return;

    // Capture the draft before React removes it, including an in-progress resize.
    return () => {
      draftHeight.current = element
        .querySelector<HTMLElement>(".chat-composer-box")
        ?.getBoundingClientRect().height;
    };
  }, []);

  useLayoutEffect(() => {
    const fromDraft = draftHeight.current;
    draftHeight.current = undefined;
    if (composing || !taskId) return;
    const arrival = session.get("task", taskId).composerArrival;
    const from = arrival ?? fromDraft;
    if (from === undefined) return;

    if (arrival !== undefined) {
      session.update("task", taskId, { composerArrival: undefined });
    }

    const element = view.current;
    if (!element || !canAnimate(element)) return;

    const animations = Array.from(
      element.querySelectorAll<HTMLElement>(".task-header, .evidence > .tabs"),
      reveal,
    );

    const box = element.querySelector<HTMLElement>(".chat-composer-box");

    if (box) {
      animations.push(
        box.animate(
          [
            { height: `${from}px`, overflow: "hidden" },
            {
              height: `${box.getBoundingClientRect().height}px`,
              overflow: "hidden",
            },
          ],
          { duration: MOTION.slow, easing: MOTION.easing },
        ),
      );
    }

    return () => animations.forEach((animation) => animation.cancel());
  }, [session, view, taskId, composing]);

  return newTaskViewRef;
}
