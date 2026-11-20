/** How fast a title slides, in pixels per second, within the bounds below. */
const SPEED = 600;
const MIN_SECONDS = 0.3;
const MAX_SECONDS = 0.7;

/** The width of `.row-title`'s right-edge fade, which the end clears. */
const FADE = 20;

/**
 * Marks a row's title when it is too long to fit, and sets how far and how
 * long it slides on hover or focus to show its end.
 */
export function measureRowTitle(row: HTMLElement) {
  const title = row.querySelector<HTMLElement>(".row-title");
  const text = title?.firstElementChild;
  if (!title || !(text instanceof HTMLElement)) return;

  const overflow = text.offsetWidth - title.clientWidth;
  title.toggleAttribute("data-overflow", overflow > 0);
  if (overflow <= 0) return;

  const distance = overflow + FADE;

  const seconds = Math.min(
    MAX_SECONDS,
    Math.max(MIN_SECONDS, distance / SPEED),
  );

  title.style.setProperty("--title-slide-distance", `${-distance}px`);
  title.style.setProperty("--title-slide-duration", `${seconds}s`);
}
