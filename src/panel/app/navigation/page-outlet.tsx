import { type ComponentType, useLayoutEffect, useRef } from "react";

import { ProjectsPage } from "../../features/projects/projects-page";
import { SettingsPage } from "../../features/settings/settings-page";
import { useSnapshot } from "../state/controller-context";
import { TasksPage } from "../tasks-page";
import { type PageId, PAGES } from "./pages";

const CONTENT: Record<PageId, ComponentType> = {
  tasks: TasksPage,
  projects: ProjectsPage,
  settings: SettingsPage,
};

/** Retained pages preserve forms and reading positions while inactive. */
export function PageOutlet() {
  const { page, selected } = useSnapshot();
  const previous = useRef(page);
  const openers = useRef(new Map<PageId, HTMLElement>());
  const root = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = root.current;

    // Record focus before the destination mounts and focuses its own heading.
    const remember = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      const id = target.closest<HTMLElement>("[data-page]")?.dataset.page as
        PageId | undefined;

      if (id) openers.current.set(id, target);
    };

    element?.addEventListener("focusin", remember);

    return () => element?.removeEventListener("focusin", remember);
  }, []);

  useLayoutEffect(() => {
    // Keep the return direction through refreshes; a new task restores detail motion.
    const slots = root.current?.querySelectorAll<HTMLElement>("[data-page]");

    slots?.forEach((slot) => {
      delete slot.dataset.returning;
    });

    if (previous.current === page) return;

    const slot = root.current?.querySelector<HTMLElement>(
      `[data-page="${page}"]`,
    );

    if (slot && PAGES[page].keepMounted) slot.dataset.returning = "true";

    const opener = openers.current.get(page);

    if (opener?.isConnected) {
      opener.focus();
    } else {
      const fallback = root.current?.querySelector<HTMLElement>(
        `#${PAGES[page].entryFocusId}`,
      );

      (
        fallback ??
        (page === "tasks"
          ? root.current?.querySelector<HTMLElement>("#settings")
          : undefined)
      )?.focus();
    }

    previous.current = page;
  }, [page, selected]);

  return (
    <div className="page-outlet" ref={root}>
      {(Object.keys(PAGES) as PageId[]).map((id) => {
        const active = id === page;
        const Content = CONTENT[id];

        if (!active && !PAGES[id].keepMounted) return null;

        return (
          <div
            key={id}
            className="app-page-slot"
            data-page={id}
            hidden={!active}
            inert={!active}
          >
            <Content />
          </div>
        );
      })}
    </div>
  );
}
