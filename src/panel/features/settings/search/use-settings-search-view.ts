import { type RefObject, useLayoutEffect, useRef, useState } from "react";

/** Keep browsing position separate from the temporary search-results view. */
export function useSettingsSearchView(form: RefObject<HTMLFormElement | null>) {
  const [query, updateQuery] = useState(""),
    active = query.trim().length > 0,
    saved = useRef<{ element: HTMLElement; top: number }[]>([]),
    previous = useRef(false);

  const setQuery = (next: string) => {
    // Capture when searching starts, since focusing the field can precede scrolling.
    if (!active && next.trim()) {
      const body = form.current?.querySelector<HTMLElement>(
          ".settings-form-body",
        ),
        page = form.current?.closest<HTMLElement>(".page-frame");

      saved.current = [body, page].flatMap((element) =>
        element ? [{ element, top: element.scrollTop }] : [],
      );
    }

    updateQuery(next);
  };

  useLayoutEffect(() => {
    const restoring = previous.current && !active;
    previous.current = active;
    if (!restoring) return;

    const targets = saved.current;
    for (const { element, top } of targets) element.scrollTop = top;

    // Panels that search closed animate open again, so the browser clamps the
    // position until they regain their height. Restore once they settle,
    // unless the user has scrolled since.
    const clamped = targets.map(({ element }) => element.scrollTop);
    let cancelled = false;

    // Wait two frames, so the reopening panels' transitions have started.
    const frame = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const root = form.current;

        // Looping animations, such as loading indicators, never finish.
        const animations =
          root && typeof root.getAnimations === "function"
            ? root
                .getAnimations({ subtree: true })
                .filter(
                  (animation) =>
                    animation.effect?.getTiming().iterations !==
                    Number.POSITIVE_INFINITY,
                )
            : [];

        void Promise.allSettled(
          animations.map((animation) => animation.finished),
        ).then(() => {
          if (cancelled) return;

          targets.forEach(({ element, top }, index) => {
            if (element.scrollTop === clamped[index]) element.scrollTop = top;
          });
        });
      }),
    );

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [active, form]);

  return { query, setQuery };
}
