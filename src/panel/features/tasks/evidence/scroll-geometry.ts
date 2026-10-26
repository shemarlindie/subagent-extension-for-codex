/** Scroll measurements and glide rules for `useReadingScroll`. */
import { reducedMotion } from "../../../shared/components/motion/motion-utils";
import type { RowPosition } from "./row-motion";

export const END_SLACK_PX = 48;

export function end(container: HTMLElement) {
  return Math.max(0, container.scrollHeight - container.clientHeight);
}

export function distanceFromEnd(container: HTMLElement) {
  return end(container) - container.scrollTop;
}

/** The scroll position that puts `row` at the top, or the end without one. */
export function glideTarget(container: HTMLElement, row?: HTMLElement) {
  if (!row) return end(container);

  const top =
    container.scrollTop +
    row.getBoundingClientRect().top -
    container.getBoundingClientRect().top;

  return Math.min(end(container), Math.max(0, top));
}

/**
 * A visible row that can hold the reader's place. A marker that moves, such
 * as Chat's New divider, opts out with `overflow-anchor: none`.
 */
export function anchorable(position: RowPosition) {
  return (
    position.bottom > 0 &&
    getComputedStyle(position.element).overflowAnchor !== "none"
  );
}

export function canGlide(container: HTMLElement) {
  return typeof container.scrollTo === "function" && !reducedMotion(container);
}

/** A smooth scroll in progress: to the latest row, or to a focused `row`. */
export type Glide = {
  target: number;
  distance: number;
  moved: boolean;
  row?: HTMLElement;
};

/** How far a glide to the end has left to scroll. */
export function glideAhead(container: HTMLElement, glide?: Glide) {
  return glide && !glide.row ? glide.target - container.scrollTop : 0;
}

/**
 * How a scroll moved `glide`: it arrived, came closer, held, or the reader
 * took over and it left. Records the progress on `glide`.
 */
export function glideProgress(glide: Glide, top: number) {
  const distance = Math.abs(top - glide.target);
  if (distance < 1) return "arrived";
  if (distance > glide.distance + 1) return "left";
  const closer = distance < glide.distance - 1;
  if (closer) glide.moved = true;
  glide.distance = distance;

  return closer ? "closer" : "held";
}
