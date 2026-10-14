import { type RefObject, useCallback, useLayoutEffect, useRef } from "react";

import {
  canAnimate,
  MOTION,
} from "../../../shared/components/motion/motion-utils";

type LeavingTask = {
  header?: HTMLElement;
  tabs?: HTMLElement;
  composerHeight?: number;
};

/** A visual copy can leave without retaining the task's subscriptions or controls. */
function leavingCopy(element: HTMLElement | null) {
  if (!element) return undefined;
  const height = element.getBoundingClientRect().height;
  const copy = element.cloneNode(true) as HTMLElement;
  copy.style.height = `${height}px`;
  copy.style.flexShrink = "0";
  copy.inert = true;
  copy.setAttribute("aria-hidden", "true");
  copy.removeAttribute("id");
  copy.querySelectorAll("[id]").forEach((child) => child.removeAttribute("id"));

  return copy;
}

/** Reverses task arrival: fold the header and tabs away and grow the draft box. */
export function useNewTaskMotion(
  detail: RefObject<HTMLElement | null>,
  composing: boolean,
  taskId: string | undefined,
) {
  const leaving = useRef<LeavingTask | undefined>(undefined);

  // React detaches the ref before removing the old view, while layout is measurable.
  const taskViewRef = useCallback((view: HTMLDivElement | null) => {
    if (!view) return;

    return () => {
      if (!canAnimate(view)) return;
      const box = view.querySelector<HTMLElement>(".chat-composer-box");

      leaving.current = {
        header: leavingCopy(view.querySelector(".task-header")),
        tabs: leavingCopy(view.querySelector(".evidence > .tabs")),
        composerHeight: box?.getBoundingClientRect().height,
      };
    };
  }, []);

  useLayoutEffect(() => {
    const from = leaving.current;
    leaving.current = undefined;
    const view = detail.current?.querySelector<HTMLElement>(".new-task-view");
    if (!composing || !from || !view || !canAnimate(view)) return;

    // The screen's normal fade-in would also fade the outgoing visual copies.
    const previousAnimation = view.style.animation;
    view.style.animation = "none";

    const animations: Animation[] = [];
    const copies: HTMLElement[] = [];
    const timing = { duration: MOTION.slow, easing: MOTION.easing };

    const collapse = (
      copy: HTMLElement | undefined,
      parent: Element | null,
    ) => {
      if (!copy || !parent) return;
      parent.prepend(copy);
      copies.push(copy);
      const style = getComputedStyle(copy);

      const animation = copy.animate(
        [
          {
            height: copy.style.height,
            marginTop: style.marginTop,
            marginBottom: style.marginBottom,
            opacity: 1,
            overflow: "hidden",
          },
          {
            height: "0px",
            marginTop: "0px",
            marginBottom: "0px",
            opacity: 0,
            overflow: "hidden",
          },
        ],
        { ...timing, fill: "forwards" },
      );

      animation.onfinish = () => copy.remove();
      animations.push(animation);
    };

    collapse(from.header, view);
    collapse(from.tabs, view.querySelector(".evidence"));
    const box = view.querySelector<HTMLElement>(".chat-composer-box");

    if (box && from.composerHeight !== undefined) {
      animations.push(
        box.animate(
          [
            { height: `${from.composerHeight}px`, overflow: "hidden" },
            {
              height: `${box.getBoundingClientRect().height}px`,
              overflow: "hidden",
            },
          ],
          timing,
        ),
      );
    }

    return () => {
      animations.forEach((animation) => animation.cancel());
      copies.forEach((copy) => copy.remove());
      view.style.animation = previousAnimation;
    };
  }, [composing, taskId, detail]);

  return taskViewRef;
}
