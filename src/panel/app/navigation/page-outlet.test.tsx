// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { PageFrame } from "../../shared/components/navigation/page-frame";
import { PageOutlet } from "./page-outlet";

const store = vi.hoisted(() => ({
  snapshot: { page: "tasks", selected: undefined as string | undefined },
  listeners: new Set<() => void>(),
}));

vi.mock("../state/controller-context", async () => {
  const { useSyncExternalStore } = await import("react");

  const subscribe = (listener: () => void) => {
    store.listeners.add(listener);

    return () => {
      store.listeners.delete(listener);
    };
  };

  return {
    useSnapshot: () => useSyncExternalStore(subscribe, () => store.snapshot),
  };
});

/** Changes the snapshot and notifies subscribers, as a controller patch does. */
function patch(changes: Partial<typeof store.snapshot> = {}) {
  act(() => {
    store.snapshot = { ...store.snapshot, ...changes };
    store.listeners.forEach((listener) => listener());
  });
}

vi.mock("../tasks-page", () => ({
  TasksPage: () => (
    <div>
      <button id="project-scope" type="button">
        Project scope
      </button>
      <input aria-label="Task draft" defaultValue="" />
    </div>
  ),
}));

vi.mock("../../features/projects/projects-page", () => ({
  ProjectsPage: () => (
    <PageFrame title="Projects" headingId="projects-heading">
      <input aria-label="Project draft" defaultValue="" />
    </PageFrame>
  ),
}));

vi.mock("../../features/settings/settings-page", () => ({
  SettingsPage: () => (
    <PageFrame title="Settings" headingId="settings-heading">
      <input aria-label="Settings draft" defaultValue="" />
    </PageFrame>
  ),
}));

afterEach(() => {
  cleanup();
  store.snapshot = { page: "tasks", selected: undefined };
});

test("retains task inputs while making the inactive page hidden and inert", () => {
  render(<PageOutlet />);
  const draft = screen.getByRole("textbox", { name: "Task draft" });
  fireEvent.change(draft, { target: { value: "Unsent message" } });

  patch({ page: "projects" });

  const slot = draft.closest("[data-page]");
  expect(slot?.hasAttribute("hidden")).toBe(true);
  expect(slot?.hasAttribute("inert")).toBe(true);
  expect(screen.queryByRole("textbox", { name: "Task draft" })).toBeNull();
  expect(draft.isConnected).toBe(true);

  patch({ page: "tasks" });

  expect(screen.getByRole("textbox", { name: "Task draft" })).toBe(draft);
  expect((draft as HTMLInputElement).value).toBe("Unsent message");
  expect(slot?.hasAttribute("hidden")).toBe(false);
  expect(slot?.hasAttribute("inert")).toBe(false);
});

test("focuses the arrival heading and returns focus to the retained task opener", () => {
  render(<PageOutlet />);
  const opener = screen.getByRole("button", { name: "Project scope" });
  opener.focus();

  patch({ page: "projects" });

  expect(document.activeElement).toBe(
    screen.getByRole("heading", { name: "Projects" }),
  );

  patch({ page: "tasks" });
  expect(document.activeElement).toBe(opener);
});

test("an initial Projects URL focuses its heading and retains the task workspace", () => {
  store.snapshot.page = "projects";
  const view = render(<PageOutlet />);

  expect(document.activeElement).toBe(
    screen.getByRole("heading", { name: "Projects" }),
  );

  expect(
    view.container.querySelector('[data-page="tasks"] input'),
  ).not.toBeNull();

  expect(screen.queryByRole("textbox", { name: "Task draft" })).toBeNull();
});

test("unmounts Settings on departure and focuses the task navigation entry", () => {
  store.snapshot.page = "settings";
  render(<PageOutlet />);
  const draft = screen.getByRole("textbox", { name: "Settings draft" });

  expect(document.activeElement).toBe(
    screen.getByRole("heading", { name: "Settings" }),
  );

  patch({ page: "tasks" });

  expect(draft.isConnected).toBe(false);

  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Project scope" }),
  );

  patch({ page: "settings" });

  const nextDraft = screen.getByRole("textbox", { name: "Settings draft" });
  expect(nextDraft).not.toBe(draft);
  expect((nextDraft as HTMLInputElement).value).toBe("");
});

test("preserves return state through polling until the selected task changes", () => {
  store.snapshot.selected = "task-1";
  const view = render(<PageOutlet />);
  const slot = view.container.querySelector('[data-page="tasks"]');

  patch({ page: "projects" });
  patch({ page: "tasks" });
  expect(slot?.getAttribute("data-returning")).toBe("true");

  patch();
  expect(slot?.getAttribute("data-returning")).toBe("true");

  patch({ selected: "task-2" });
  expect(slot?.hasAttribute("data-returning")).toBe(false);
});
