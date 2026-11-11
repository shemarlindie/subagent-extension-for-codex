import { type RefObject, useLayoutEffect, useRef, useState } from "react";

/** Keep browsing position separate from the temporary search-results view. */
export function useSettingsSearchView(form: RefObject<HTMLFormElement | null>) {
  const [query, updateQuery] = useState("");
  const active = query.trim().length > 0;
  const saved = useRef<{ element: HTMLElement; top: number }[]>([]);
  const previous = useRef(false);

  const setQuery = (next: string) => {
    // Capture when searching starts, since focusing the field can precede scrolling.
    if (!active && next.trim()) {
      const body = form.current?.querySelector<HTMLElement>(
        ".settings-form-body",
      );

      const page = form.current?.closest<HTMLElement>(".page-frame");

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

    for (const { element, top } of saved.current) element.scrollTop = top;

    // Panels that search closed animate open again, so the browser clamps the
    // position until they regain their height. Restore as their content grows,
    // unless the user has scrolled since.
    let pending = saved.current
      .filter(({ element, top }) => element.scrollTop !== top)
      .map((target) => ({ ...target, clamped: target.element.scrollTop }));

    // Sections grow inside the form body in both the page and the dialog.
    const sections = form.current?.querySelector(".settings-sections-layer");

    if (!pending.length || !sections || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      pending = pending.filter((target) => {
        if (target.element.scrollTop !== target.clamped) return false;
        target.element.scrollTop = target.top;
        target.clamped = target.element.scrollTop;

        return target.clamped !== target.top;
      });

      if (!pending.length) observer.disconnect();
    });

    observer.observe(sections);

    return () => observer.disconnect();
  }, [active, form]);

  return { query, setQuery };
}
