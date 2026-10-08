import { MOTION, reducedMotion } from "../components/motion-utils";

/** Uses native nearest-edge positioning with a short, fixed scroll duration. */
export function animateScrollIntoView(element: HTMLElement) {
  const view = element.ownerDocument.defaultView!;
  let frame = view.requestAnimationFrame(() => {
    const ancestors: { element: HTMLElement; start: number; end: number }[] =
      [];

    for (
      let parent = element.parentElement;
      parent;
      parent = parent.parentElement
    )
      ancestors.push({ element: parent, start: parent.scrollTop, end: 0 });

    element.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: "instant",
    });

    if (reducedMotion(element)) return;

    const scrolling = ancestors.filter((ancestor) => {
      ancestor.end = ancestor.element.scrollTop;

      return ancestor.start !== ancestor.end;
    });

    if (!scrolling.length) return;

    for (const ancestor of scrolling)
      ancestor.element.scrollTop = ancestor.start;

    const started = view.performance.now();

    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / MOTION.fast),
        eased = 1 - (1 - progress) ** 3;

      for (const ancestor of scrolling)
        ancestor.element.scrollTop =
          ancestor.start + (ancestor.end - ancestor.start) * eased;

      if (progress < 1) frame = view.requestAnimationFrame(tick);
    };

    frame = view.requestAnimationFrame(tick);
  });

  return () => view.cancelAnimationFrame(frame);
}
