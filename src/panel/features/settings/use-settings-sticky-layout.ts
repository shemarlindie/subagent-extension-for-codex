import { type RefObject, useLayoutEffect } from "react";

/** Stack sticky controls using their rendered sizes, including host font overrides. */
export function useSettingsStickyLayout(
  form: RefObject<HTMLFormElement | null>,
) {
  useLayoutEffect(() => {
    const page = form.current?.closest<HTMLElement>(".settings-page");
    const heading = page?.querySelector<HTMLElement>(".page-frame-heading");
    const search = form.current?.querySelector<HTMLElement>(".settings-search");

    if (!page || !heading || !search) return;

    const measure = () => {
      const height = heading.getBoundingClientRect().height;
      if (!height) return;

      page.style.setProperty("--settings-heading-height", `${height}px`);

      page.style.setProperty(
        "--settings-search-height",
        `${search.getBoundingClientRect().height}px`,
      );
    };

    measure();
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(measure);
    observer.observe(heading);
    observer.observe(search);

    return () => observer.disconnect();
  }, [form]);
}
