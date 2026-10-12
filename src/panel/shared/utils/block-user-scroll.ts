/** Prevent a loading region from moving while preserving browser zoom gestures. */
export function blockUserScroll(element: HTMLElement) {
  const preventWheelScroll = (event: WheelEvent) => {
    if (!event.ctrlKey) event.preventDefault();
  };

  const preventTouchScroll = (event: TouchEvent) => {
    if (event.touches.length <= 1) event.preventDefault();
  };

  const preventKeyScroll = (event: KeyboardEvent) => {
    if (
      [
        "ArrowDown",
        "ArrowUp",
        "End",
        "Home",
        "PageDown",
        "PageUp",
        " ",
      ].includes(event.key)
    )
      event.preventDefault();
  };

  element.addEventListener("wheel", preventWheelScroll, { passive: false });

  element.addEventListener("touchmove", preventTouchScroll, {
    passive: false,
  });

  element.addEventListener("keydown", preventKeyScroll);

  return () => {
    element.removeEventListener("wheel", preventWheelScroll);
    element.removeEventListener("touchmove", preventTouchScroll);
    element.removeEventListener("keydown", preventKeyScroll);
  };
}
