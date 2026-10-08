/** A timeline can own its scroll or share the inspector's in a short layout. */
export function scrollContainer(viewport: HTMLElement) {
  for (let element: HTMLElement | null = viewport; element;) {
    if (/auto|scroll/.test(getComputedStyle(element).overflowY)) return element;
    element = element.parentElement;
  }

  return viewport;
}
