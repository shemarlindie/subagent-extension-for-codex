import { MOTION } from "../../../shared/components/motion/motion-utils";

/** A row's box relative to the top of its scroll container. */
export type RowPosition = { element: HTMLElement; top: number; bottom: number };

/** Measure each row carrying `attribute`, keyed by that attribute's value. */
export function measureRows(
  viewport: HTMLElement,
  container: HTMLElement,
  attribute: string,
) {
  const top = container.getBoundingClientRect().top;
  const rows = new Map<string, RowPosition>();

  for (const element of Array.from(
    viewport.querySelectorAll<HTMLElement>(`[${attribute}]`),
  )) {
    const rect = element.getBoundingClientRect();

    rows.set(element.getAttribute(attribute)!, {
      element,
      top: rect.top - top,
      bottom: rect.bottom - top,
    });
  }

  return rows;
}

/** The rows in view, relative to the scroll container's top. */
export type RowView = { top: number; bottom: number };

/**
 * Move retained rows in `view` from their old position and fade new rows in.
 * With `arrivalsOnly`, retained rows jump to their new place and new rows
 * fade without moving, so measuring rows mid-fade stays accurate.
 */
export function animateRows(
  previous: Map<string, RowPosition>,
  next: Map<string, RowPosition>,
  view: RowView,
  arrivalsOnly = false,
) {
  const animations: Animation[] = [];

  for (const [id, position] of next) {
    const old = previous.get(id);
    if (old && arrivalsOnly) continue;
    const delta = old ? old.top - position.top : 12;
    if (position.bottom < view.top || position.top > view.bottom) continue;
    if (old && Math.abs(delta) <= 1) continue;
    // jsdom, which runs the panel tests, has no Web Animations.
    if (typeof position.element.animate !== "function") continue;

    const animation = position.element.animate(
      arrivalsOnly
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [
            { transform: `translateY(${delta}px)`, opacity: old ? 1 : 0 },
            { transform: "translateY(0)", opacity: 1 },
          ],
      { duration: MOTION.slow, easing: MOTION.easing },
    );

    animations.push(animation);
  }

  return animations;
}
