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

/** Move visible retained rows from their old position and fade new rows in. */
export function animateRows(
  previous: Map<string, RowPosition>,
  next: Map<string, RowPosition>,
  height: number,
) {
  const animations: Animation[] = [];

  for (const [id, position] of next) {
    const old = previous.get(id);
    const delta = old ? old.top - position.top : 12;
    if (position.bottom < 0 || position.top > height) continue;
    if (old && Math.abs(delta) <= 1) continue;

    const animation = position.element.animate?.(
      [
        { transform: `translateY(${delta}px)`, opacity: old ? 1 : 0 },
        { transform: "translateY(0)", opacity: 1 },
      ],
      { duration: MOTION.slow, easing: MOTION.easing },
    );

    if (animation) animations.push(animation);
  }

  return animations;
}
