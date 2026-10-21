// @vitest-environment jsdom
import assert from "node:assert/strict";

import { Tooltip } from "@base-ui/react/tooltip";
import { cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";

import { roles } from "../../../../shared/tasks/model";
import { Controller } from "../../../app/state/controller";
import { ControllerContext } from "../../../app/state/controller-context";
import { defaults } from "../../../app/state/controller-test-harness";
import type {
  NewTaskState,
  Snapshot,
  Transport,
} from "../../../app/state/types";
import { NewTaskView } from "./new-task-view";

const ready: NewTaskState = {
  scope: 0,
  request: 1,
  statuses: {
    context: "ready",
    settings: "ready",
    projects: "ready",
    workers: "ready",
  },
  defaults: { ...defaults, claude_permission_mode: "acceptEdits" },
};

function setup(
  newTask: NewTaskState = ready,
  overrides: Partial<Snapshot> = {},
) {
  onTestFinished(cleanup);

  const controller = new Controller(
    { embedded: true, dispose() {} } as unknown as Transport,
    { hidden: () => false, wide: () => false },
  );

  onTestFinished(() => controller.dispose());

  const state: Snapshot = {
    ...controller.getSnapshot(),
    connected: true,
    scopeKnown: true,
    repository: "/repo",
    projects: [{ repository: "/repo", kind: "repository" }],
    projectsLoaded: true,
    workers: [{ provider: "claude", profiles: [...roles], capabilities: {} }],
    workersLoaded: true,
    newTask,
    ...overrides,
  };

  vi.spyOn(controller, "getSnapshot").mockReturnValue(state);

  const start = vi
    .spyOn(controller.newTasks, "start")
    .mockResolvedValue(undefined);

  const retry = vi.spyOn(controller.newTasks, "retry").mockReturnValue();
  const back = vi.spyOn(controller, "back").mockReturnValue();

  const saveProfileSetting = vi
    .spyOn(controller.newTasks, "saveProfileSetting")
    .mockResolvedValue(undefined);

  const view = render(
    <ControllerContext.Provider value={controller}>
      <Tooltip.Provider>
        <NewTaskView newTask={newTask} />
      </Tooltip.Provider>
    </ControllerContext.Provider>,
  );

  return {
    view,
    user: userEvent.setup(),
    start,
    retry,
    back,
    saveProfileSetting,
  };
}

test("Shift+Enter adds a line instead of sending", async () => {
  const { view, user, start } = setup();
  const message = view.getByRole("textbox", { name: "Task message" });

  await user.type(message, "First{Shift>}{Enter}{/Shift}Second");

  assert.equal((message as HTMLTextAreaElement).value, "First\nSecond");
  assert.equal(start.mock.calls.length, 0);
});

test("the profile's settings collapse into a summary that expands for editing", async () => {
  const { view, user } = setup();

  expect(view.queryByRole("combobox", { name: /^Model/ })).toBeNull();

  const toggle = view.getByRole("button", { name: /^Edit .* · Accept edits$/ });

  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  // The visible line abbreviates; the label above keeps the full names.
  assert.match(toggle.textContent ?? "", / · Edits$/);
  await user.click(toggle);

  const controls = toggle.getAttribute("aria-controls")?.split(" ") ?? [];

  expect(controls).toEqual([
    "new-task-model",
    "new-task-reasoning",
    "new-task-permission",
  ]);

  for (const id of controls) expect(document.getElementById(id)).not.toBeNull();
  assert.ok(view.getByRole("combobox", { name: /^Model: / }));
  assert.ok(view.getByRole("combobox", { name: "Reasoning effort: Default" }));

  await user.click(
    view.getByRole("combobox", { name: "Permission mode: Accept edits" }),
  );

  // The menu names the mode in full; the chip shortens it.
  await user.click(
    await view.findByRole("option", { name: /ask for approval/i }),
  );

  assert.ok(view.getByRole("combobox", { name: "Permission mode: Ask" }));
  await user.click(view.getByRole("button", { name: "Hide profile settings" }));

  expect(view.queryByRole("combobox", { name: /^Model/ })).toBeNull();
  expect(toggle.getAttribute("aria-controls")).toBeNull();
  expect(document.activeElement).toBe(toggle);
});

test("reasoning choices save to the profile, and choosing a profile restores its saved settings", async () => {
  const { view, user, start, saveProfileSetting } = setup({
    ...ready,
    defaults: {
      ...defaults,
      claude_default_reasoning_effort: "medium",
      implementer_default_reasoning_effort: "low",
    },
  });

  await user.click(view.getByRole("button", { name: /^Edit / }));
  await user.click(view.getByRole("combobox", { name: /^Reasoning effort/ }));
  await user.click(await view.findByRole("option", { name: "High" }));

  expect(saveProfileSetting.mock.calls).toEqual([
    ["claude:general", "reasoning_effort", "high"],
  ]);

  await user.click(view.getByRole("combobox", { name: "Profile: General" }));
  await user.click(await view.findByRole("option", { name: "Implementer" }));

  // Default clears the profile's setting, so it names the provider's.
  await user.click(
    view.getByRole("combobox", { name: /^Reasoning effort: Low/ }),
  );

  assert.ok(await view.findByRole("option", { name: "Default (medium)" }));
  await user.keyboard("{Escape}");

  await user.type(
    view.getByRole("textbox", { name: "Task message" }),
    "Ship it{Enter}",
  );

  await waitFor(() => assert.equal(start.mock.calls.length, 1));

  expect(start.mock.calls[0]?.[0]).toMatchObject({
    worker: "claude:implementer",
    model: "",
    reasoning_effort: "low",
  });
});

test("a read-only profile replaces the permission choice with Read only", async () => {
  const { view, user } = setup();

  await user.click(view.getByRole("combobox", { name: "Profile: General" }));
  await user.click(await view.findByRole("option", { name: "Reviewer" }));

  assert.ok(view.getByRole("button", { name: /· Read only$/ }));
  await user.click(view.getByRole("button", { name: /^Edit / }));

  const permission = await view.findByRole("combobox", {
    name: "Permission mode: Read only",
  });

  assert.equal(permission.getAttribute("data-disabled"), "");
});

test("the project chip appears only without a scoped project", () => {
  const scoped = setup();

  expect(scoped.view.queryByRole("combobox", { name: /^Project/ })).toBeNull();
  cleanup();

  const global = setup(ready, {
    repository: undefined,
    projects: [
      { repository: "/repo", kind: "repository" },
      { repository: "/other", kind: "repository" },
    ],
  });

  assert.ok(
    global.view.getByRole("combobox", { name: "Project: Choose a project" }),
  );

  assert.equal(
    (
      global.view.getByRole("button", {
        name: "Start task",
      }) as HTMLButtonElement
    ).disabled,
    true,
  );
});

test("Escape in an empty composer returns to the task list", async () => {
  const { view, user, back } = setup();

  await user.click(view.getByRole("textbox", { name: "Task message" }));
  await user.keyboard("{Escape}");

  assert.equal(back.mock.calls.length, 1);
});

test("failed reads show the error with a retry", async () => {
  const { view, user, retry } = setup({
    ...ready,
    statuses: { ...ready.statuses, settings: "error" },
    errors: { settings: "Service unavailable" },
  });

  assert.ok(
    view.getByText("Task defaults could not be loaded: Service unavailable"),
  );

  await user.click(view.getByRole("button", { name: "Retry loading" }));
  assert.equal(retry.mock.calls.length, 1);
});
