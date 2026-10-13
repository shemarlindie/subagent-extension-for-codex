// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { PageFrame } from "../../shared/components/navigation/page-frame";
import { PageOutlet } from "./page-outlet";

const state = vi.hoisted(() => ({
  page: "tasks",
  selected: undefined as string | undefined,
}));

vi.mock("../state/controller-context", () => ({ useSnapshot: () => state }));

vi.mock("../tasks-page", () => ({
  TasksPage: () => (
    <div>
      <button id="manage-projects" type="button">
        Manage projects
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
  state.page = "tasks";
  state.selected = undefined;
});

test("retains task inputs while making the inactive page hidden and inert", () => {
  const view = render(<PageOutlet />);
  const draft = screen.getByRole("textbox", { name: "Task draft" });
  fireEvent.change(draft, { target: { value: "Unsent message" } });

  state.page = "projects";
  view.rerender(<PageOutlet />);

  const slot = draft.closest("[data-page]");
  expect(slot?.hasAttribute("hidden")).toBe(true);
  expect(slot?.hasAttribute("inert")).toBe(true);
  expect(screen.queryByRole("textbox", { name: "Task draft" })).toBeNull();
  expect(draft.isConnected).toBe(true);

  state.page = "tasks";
  view.rerender(<PageOutlet />);

  expect(screen.getByRole("textbox", { name: "Task draft" })).toBe(draft);
  expect((draft as HTMLInputElement).value).toBe("Unsent message");
  expect(slot?.hasAttribute("hidden")).toBe(false);
  expect(slot?.hasAttribute("inert")).toBe(false);
});

test("unmounts projects on departure and creates fresh inputs on each visit", () => {
  state.page = "projects";
  const view = render(<PageOutlet />);
  const draft = screen.getByRole("textbox", { name: "Project draft" });
  fireEvent.change(draft, { target: { value: "Temporary rename" } });

  state.page = "tasks";
  view.rerender(<PageOutlet />);
  expect(draft.isConnected).toBe(false);
  expect(view.container.querySelector('[data-page="projects"]')).toBeNull();

  state.page = "projects";
  view.rerender(<PageOutlet />);
  const nextDraft = screen.getByRole("textbox", { name: "Project draft" });
  expect(nextDraft).not.toBe(draft);
  expect((nextDraft as HTMLInputElement).value).toBe("");
});

test("focuses the arrival heading and returns focus to the retained task opener", () => {
  const view = render(<PageOutlet />);
  const opener = screen.getByRole("button", { name: "Manage projects" });
  opener.focus();

  state.page = "projects";
  view.rerender(<PageOutlet />);

  expect(document.activeElement).toBe(
    screen.getByRole("heading", { name: "Projects" }),
  );

  state.page = "tasks";
  view.rerender(<PageOutlet />);
  expect(document.activeElement).toBe(opener);
});

test("an initial Projects URL focuses its heading and retains the task workspace", () => {
  state.page = "projects";
  const view = render(<PageOutlet />);

  expect(document.activeElement).toBe(
    screen.getByRole("heading", { name: "Projects" }),
  );

  expect(
    view.container.querySelector('[data-page="tasks"] input'),
  ).not.toBeNull();

  expect(screen.queryByRole("textbox", { name: "Task draft" })).toBeNull();
});

test("returning from an initial Projects URL focuses the task navigation entry", () => {
  state.page = "projects";
  const view = render(<PageOutlet />);

  state.page = "tasks";
  view.rerender(<PageOutlet />);

  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Manage projects" }),
  );
});

test("unmounts Settings on departure and focuses the task navigation entry", () => {
  state.page = "settings";
  const view = render(<PageOutlet />);
  const draft = screen.getByRole("textbox", { name: "Settings draft" });

  expect(document.activeElement).toBe(
    screen.getByRole("heading", { name: "Settings" }),
  );

  state.page = "tasks";
  view.rerender(<PageOutlet />);

  expect(draft.isConnected).toBe(false);

  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Manage projects" }),
  );

  state.page = "settings";
  view.rerender(<PageOutlet />);

  const nextDraft = screen.getByRole("textbox", { name: "Settings draft" });
  expect(nextDraft).not.toBe(draft);
  expect((nextDraft as HTMLInputElement).value).toBe("");
});

test("preserves return state through polling until the selected task changes", () => {
  state.selected = "task-1";
  const view = render(<PageOutlet />);
  const slot = view.container.querySelector('[data-page="tasks"]');

  state.page = "projects";
  view.rerender(<PageOutlet />);
  state.page = "tasks";
  view.rerender(<PageOutlet />);
  expect(slot?.getAttribute("data-returning")).toBe("true");

  view.rerender(<PageOutlet />);
  expect(slot?.getAttribute("data-returning")).toBe("true");

  state.selected = "task-2";
  view.rerender(<PageOutlet />);
  expect(slot?.hasAttribute("data-returning")).toBe(false);
});
