const IDLE_MS = 1000;

/** Show custom scrollbars during interaction, without changing scroll layout. */
export function trackIdleScrollbars(doc: Document) {
  const view = doc.defaultView!;
  const timers = new Map<HTMLElement, number>();
  const pressed = new Map<number, HTMLElement>();

  const isPressed = (element: HTMLElement) =>
    [...pressed.values()].includes(element);

  const show = (element: HTMLElement) => {
    view.clearTimeout(timers.get(element));
    element.dataset.scrollbarActive = "true";

    timers.set(
      element,
      view.setTimeout(() => {
        if (isPressed(element)) return;

        delete element.dataset.scrollbarActive;
        timers.delete(element);
      }, IDLE_MS),
    );
  };

  const scroller = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return undefined;

    const ownerId = target.closest<HTMLElement>("[data-scrollbar-owner]")
      ?.dataset.scrollbarOwner;

    const owner = ownerId ? doc.getElementById(ownerId) : null;

    if (owner instanceof HTMLElement) return owner;

    for (
      let element: HTMLElement | null =
        target instanceof HTMLElement ? target : target.parentElement;
      element;
      element = element.parentElement
    ) {
      const vertical = element.scrollHeight > element.clientHeight;
      const horizontal = element.scrollWidth > element.clientWidth;

      if (!vertical && !horizontal) continue;

      const style = view.getComputedStyle(element);

      if (
        (vertical && /auto|scroll/.test(style.overflowY)) ||
        (horizontal && /auto|scroll/.test(style.overflowX))
      )
        return element;
    }

    return undefined;
  };

  const onScroll = (event: Event) => {
    const target = event.target === doc ? doc.scrollingElement : event.target;

    if (target instanceof HTMLElement) show(target);
  };

  const onPointerMove = (event: PointerEvent) => {
    const element = scroller(event.target);

    if (element) show(element);
  };

  const onPointerDown = (event: PointerEvent) => {
    const element = scroller(event.target);

    if (!element) return;

    pressed.set(event.pointerId, element);
    show(element);
  };

  const onPointerEnd = (event: PointerEvent) => {
    const element = pressed.get(event.pointerId);

    if (!element) return;

    pressed.delete(event.pointerId);
    show(element);
  };

  const onBlur = () => {
    if (!pressed.size) return;

    const elements = new Set(pressed.values());

    pressed.clear();
    for (const element of elements) show(element);
  };

  doc.addEventListener("scroll", onScroll, true);
  doc.addEventListener("pointermove", onPointerMove, { passive: true });
  doc.addEventListener("pointerdown", onPointerDown, { passive: true });
  doc.addEventListener("pointerup", onPointerEnd, { passive: true });
  doc.addEventListener("pointercancel", onPointerEnd, { passive: true });
  view.addEventListener("blur", onBlur);

  return () => {
    doc.removeEventListener("scroll", onScroll, true);
    doc.removeEventListener("pointermove", onPointerMove);
    doc.removeEventListener("pointerdown", onPointerDown);
    doc.removeEventListener("pointerup", onPointerEnd);
    doc.removeEventListener("pointercancel", onPointerEnd);
    view.removeEventListener("blur", onBlur);

    for (const [element, timer] of timers) {
      view.clearTimeout(timer);
      delete element.dataset.scrollbarActive;
    }

    timers.clear();
  };
}
