import { type RefObject, useLayoutEffect } from "react";

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

  element.animate(
    [
      { height: "0px", opacity: 0, overflow: "hidden" },
      { height: `${height}px`, opacity: 1, overflow: "hidden" },
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
) {
  const { session } = useController();

  useLayoutEffect(() => {
    if (!taskId) return;
    const from = session.get("task", taskId).composerArrival;
    if (from === undefined) return;

    session.update("task", taskId, { composerArrival: undefined });
    const element = view.current;
    if (!element || !canAnimate(element)) return;

    element
      .querySelectorAll<HTMLElement>(".task-header, .evidence > .tabs")
      .forEach(reveal);

    const box = element.querySelector<HTMLElement>(".chat-composer-box");

    box?.animate(
      [
        { height: `${from}px`, overflow: "hidden" },
        {
          height: `${box.getBoundingClientRect().height}px`,
          overflow: "hidden",
        },
      ],
      { duration: MOTION.slow, easing: MOTION.easing },
    );
  }, [session, view, taskId]);
}
