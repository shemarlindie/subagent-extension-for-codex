import { end, shrinking } from "./scroll-geometry";

// How quickly a glide to the end closes in, per second. Higher follows a fast
// stream more closely, with a sharper start.
const FOLLOW_RATE = 14;

/**
 * Advances a glide to the end by `seconds` as a critically damped spring.
 * `offset` is the distance from the end, negative above it. A moving end keeps
 * the speed, so frequent updates never restart the glide from rest.
 */
function followStep(offset: number, velocity: number, seconds: number) {
  const decay = Math.exp(-FOLLOW_RATE * seconds);
  const drift = (velocity + FOLLOW_RATE * offset) * seconds;

  return {
    offset: (offset + drift) * decay,
    velocity: (velocity - FOLLOW_RATE * drift) * decay,
  };
}

export type EndFollower = {
  /**
   * Whether a scroll to `top` keeps the glide going: its own write, a reader
   * scrolling further down, or a shrinking row's clamp in `viewport`. A reader
   * scrolling up from it, such as by dragging the scrollbar, ends it.
   */
  holds: (top: number, viewport: HTMLElement) => boolean;
  cancel: () => void;
};

/**
 * Glides `container` to its end frame by frame, following the end as content
 * grows, and calls `arrived` once it reaches the end. A native smooth scroll
 * restarts from rest on every retarget, so a fast stream would leave it
 * crawling behind.
 */
export function followEnd(
  container: HTMLElement,
  arrived: () => void,
): EndFollower {
  let position = container.scrollTop;
  let velocity = 0;
  let top = position;
  let time: number | undefined;

  const step = (now: number) => {
    const seconds =
      time === undefined ? 1 / 60 : Math.min(now - time, 100) / 1000;

    time = now;

    // Continue from where the reader scrolled further down. A drop is a clamp
    // the next write undoes, since a reader scrolling up ends the glide.
    if (container.scrollTop - top >= 1) {
      position = container.scrollTop;
    }

    const target = end(container);
    const next = followStep(position - target, velocity, seconds);

    if (next.offset > -0.5) {
      arrived();

      return;
    }

    position = target + next.offset;
    velocity = next.velocity;
    container.scrollTop = position;
    top = container.scrollTop;
    frame = requestAnimationFrame(step);
  };

  let frame = requestAnimationFrame(step);

  return {
    holds: (scrolled, viewport) => scrolled >= top - 1 || shrinking(viewport),
    cancel: () => cancelAnimationFrame(frame),
  };
}
