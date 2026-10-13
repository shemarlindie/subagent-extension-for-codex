// Scrolls only the list, never the page, so surrounding layout doesn't jump.
// A hidden list has no layout to measure, so it is left alone.
export function scrollChildIntoView(
  list: HTMLElement,
  child: HTMLElement,
  gap: number,
) {
  if (!list.clientWidth) return;

  const left = child.offsetLeft - gap,
    right = child.offsetLeft + child.offsetWidth + gap;

  let target: number | undefined;

  if (left < list.scrollLeft) {
    target = left;
  } else if (right > list.scrollLeft + list.clientWidth) {
    target = right - list.clientWidth;
  }

  if (target !== undefined) {
    list.scrollTo?.({
      left: Math.max(0, target),
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }
}
