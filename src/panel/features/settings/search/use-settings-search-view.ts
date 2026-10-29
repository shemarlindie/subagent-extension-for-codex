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
    if (previous.current && !active) {
      for (const { element, top } of saved.current) element.scrollTop = top;
    }

    previous.current = active;
  }, [active]);

  return { query, setQuery };
}
