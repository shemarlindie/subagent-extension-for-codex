/** Scroll measurements and glide rules for `useReadingScroll`. */
import { reducedMotion } from "../../../shared/components/motion/motion-utils";
import type { EndFollower } from "./end-follower";
import type { ReadingPosition } from "./reading-state";
import type { RowPosition } from "./row-motion";

export const END_SLACK_PX = 48;

export function end(container: HTMLElement) {
  return Math.max(0, container.scrollHeight - container.clientHeight);
}

export function distanceFromEnd(container: HTMLElement) {
  return end(container) - container.scrollTop;
}

/**
 * Whether a scroll leaves the reader following the end. An animated scroll away
 * reports its first frames close to the end, so a reader released at
 * `releasedTop` must return there first. Otherwise the next update would glide
 * back over the gesture.
 */
export function followsEnd(container: HTMLElement, releasedTop?: number) {
  const away =
    releasedTop !== undefined &&
    container.scrollTop < Math.min(releasedTop, end(container));

  return !away && distanceFromEnd(container) <= END_SLACK_PX;
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

/** The row whose `attribute` is `id`. */
export function findRow(viewport: HTMLElement, attribute: string, id: string) {
  return Array.from(
    viewport.querySelectorAll<HTMLElement>(`[${attribute}]`),
  ).find((element) => element.getAttribute(attribute) === id);
}

/** Whether `row` shows in full within the container's frame. */
export function inView(container: HTMLElement, row: HTMLElement) {
  const { top, bottom } = row.getBoundingClientRect();
  const frame = container.getBoundingClientRect();

  return top >= frame.top && bottom <= frame.bottom;
}

/** Restores the saved row, or another visible row when history was trimmed. */
export function restoreReadingAnchor(
  viewport: HTMLElement,
  container: HTMLElement,
  attribute: string,
  saved: ReadingPosition,
  previous: Map<string, RowPosition>,
  scrolled: number,
) {
  container.scrollTop = saved.top + scrolled;

  const saving = saved.anchor;
  const element = saving && findRow(viewport, attribute, saving.id);

  const anchor =
    saving && element
      ? { element, top: saving.top }
      : [...previous.values()].find(
          (position) => anchorable(position) && position.element.isConnected,
        );

  if (anchor) {
    container.scrollTop +=
      anchor.element.getBoundingClientRect().top -
      container.getBoundingClientRect().top -
      (anchor.top - scrolled);
  }
}

/**
 * Whether a row in `viewport` is easing to a smaller height. Measuring its new
 * height lays out the shorter content, which clamps the scroll position before
 * the animation holds the old height again.
 */
export function shrinking(viewport: HTMLElement) {
  if (typeof viewport.getAnimations !== "function") return false;

  return viewport.getAnimations({ subtree: true }).some((animation) => {
    const frames = (animation.effect as KeyframeEffect | null)?.getKeyframes();
    const height = (frame?: Keyframe) => parseFloat(String(frame?.height));

    return height(frames?.[0]) > height(frames?.at(-1));
  });
}

/**
 * How far the reader scrolled from `saved` before the browser delivered the
 * scroll event. A `pinned` view that drops while a row shrinks was clamped by
 * layout, so the reader did not move.
 */
export function pendingScroll(
  viewport: HTMLElement,
  container: HTMLElement,
  saved: ReadingPosition | undefined,
  pinned: boolean,
) {
  const moved = saved ? container.scrollTop - saved.top : 0;

  return moved < 0 && pinned && shrinking(viewport) ? 0 : moved;
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
  /** Drives a glide to the end frame by frame. */
  follower?: EndFollower;
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

/** Jumps to `target`, returning the position whose scroll event to ignore. */
export function jump(container: HTMLElement, target: number) {
  const moved = Math.abs(container.scrollTop - target) >= 1;
  container.scrollTop = target;

  return moved ? target : undefined;
}
