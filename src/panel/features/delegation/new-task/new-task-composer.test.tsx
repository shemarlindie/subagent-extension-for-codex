// @vitest-environment jsdom
import assert from "node:assert/strict";

import { Tooltip } from "@base-ui/react/tooltip";
import { cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";

import { withSetting } from "../../../../shared/settings/settings-schema";
import { roles } from "../../../../shared/tasks/model";
import { Controller } from "../../../app/state/controller";
import { ControllerContext } from "../../../app/state/controller-context";
import { defaults } from "../../../app/state/controller-test-harness";
import type {
  NewTaskState,
  Snapshot,
  Transport,
} from "../../../app/state/types";
import type { DelegateValues } from "../delegate-values";
import { NEW_TASK_SESSION_ID } from "./new-task-values";
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
  defaults: withSetting(
    defaults,
    "providers.claude.permission_mode",
    "acceptEdits",
  ),
};

function setup(
  newTask: NewTaskState = ready,
  overrides: Partial<Snapshot> = {},
  draft?: Partial<DelegateValues>,
) {
  onTestFinished(cleanup);

  const controller = new Controller(
    { embedded: true, dispose() {} } as unknown as Transport,
    { hidden: () => false, wide: () => false },
  );

  onTestFinished(() => controller.dispose());

  if (draft) {
    controller.session.update("newTask", NEW_TASK_SESSION_ID, { draft });
  }

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

test("an excluded model saved for the provider reads as the default", async () => {
  const { view } = setup(
    {
      ...ready,
      defaults: withSetting(
        ready.defaults!,
        "models.providers.claude.model",
        "claude-sonnet-5-5",
      ),
    },
    {
      workers: [
        {
          provider: "claude",
          profiles: [...roles],
          capabilities: {},
          policy: {
            managed: true,
            blocked: [],
            available_models: ["haiku"],
            available_models_match: "prefix",
            notes: [],
          },
        },
      ],
    },
  );

  assert.ok(await view.findByRole("button", { name: /^Edit Default model/ }));
});

test("a draft's blocked mode shows and sends as the fallback", async () => {
  const { view, user, start } = setup(
    ready,
    {
      workers: [
        {
          provider: "claude",
          profiles: [...roles],
          capabilities: {},
          policy: {
            managed: true,
            blocked: [
              {
                value: "auto",
                reason: "Turned off by your organization",
              },
            ],
            notes: [],
          },
        },
      ],
    },
    { permission_mode: "auto" },
  );

  assert.ok(await view.findByRole("button", { name: /^Edit .*Ask/ }));
  await user.click(view.getByRole("textbox"));
  await user.paste("Do it");
  await user.keyboard("{Enter}");

  await waitFor(() =>
    assert.equal(start.mock.calls[0]?.[0].permission_mode, "default"),
  );
});

test("the profile's settings collapse into a summary that expands for editing", async () => {
  const { view, user } = setup();

  expect(view.queryByRole("combobox", { name: /^Model/ })).toBeNull();

  const toggle = view.getByRole("button", { name: /^Edit .* · Accept edits$/ });

  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  await user.click(toggle);

  const controls = toggle.getAttribute("aria-controls")?.split(" ") ?? [];

  expect(controls.length).toBeGreaterThan(0);

  for (const id of controls) expect(document.getElementById(id)).not.toBeNull();
  assert.ok(view.getByRole("combobox", { name: /^Model: / }));
  assert.ok(view.getByRole("combobox", { name: "Reasoning: Default" }));

  assert.ok(
    view.getByRole("combobox", { name: "Permission mode: Accept edits" }),
  );

  await user.click(view.getByRole("button", { name: "Hide profile settings" }));

  expect(view.queryByRole("combobox", { name: /^Model/ })).toBeNull();
  expect(toggle.getAttribute("aria-controls")).toBeNull();
  expect(document.activeElement).toBe(toggle);
});

test("reasoning choices save to the profile, and choosing a profile restores its saved settings", async () => {
  const { view, user, start, saveProfileSetting } = setup({
    ...ready,
    defaults: withSetting(
      withSetting(
        defaults,
        "models.providers.claude.reasoning_effort",
        "medium",
      ),
      "models.profiles.researcher.reasoning_effort",
      "low",
    ),
  });

  await user.click(view.getByRole("button", { name: /^Edit / }));
  await user.click(view.getByRole("combobox", { name: /^Reasoning/ }));
  await user.click(await view.findByRole("option", { name: "High" }));

  expect(saveProfileSetting.mock.calls).toEqual([
    ["claude:implementer", "reasoning_effort", "high"],
  ]);

  await user.click(
    view.getByRole("combobox", { name: "Profile: Implementer" }),
  );

  await user.click(await view.findByRole("option", { name: "Researcher" }));

  // Default clears the profile's setting, so it names the provider's.
  await user.click(view.getByRole("combobox", { name: /^Reasoning: Low/ }));

  assert.ok(await view.findByRole("option", { name: "Default (medium)" }));
  await user.keyboard("{Escape}");

  await user.type(
    view.getByRole("textbox", { name: "Task message" }),
    "Ship it{Enter}",
  );

  await waitFor(() => assert.equal(start.mock.calls.length, 1));

  expect(start.mock.calls[0]?.[0]).toMatchObject({
    worker: "claude:researcher",
    model: "",
    reasoning_effort: "low",
  });
});

test("under the org's defaults the composer starts on them, and a pick stays with the task", async () => {
  const saved = withSetting(
    withSetting(ready.defaults!, "models.profiles.implementer.model", "opus"),
    "models.profiles.implementer.reasoning_effort",
    "high",
  );

  const { view, user, start, saveProfileSetting } = setup(
    { ...ready, defaults: saved },
    {
      workers: [
        {
          provider: "claude",
          profiles: [...roles],
          capabilities: {},
          policy: {
            managed: true,
            blocked: [],
            default_model: "Sonnet 5.5",
            default_effort: "low",
            notes: [],
          },
        },
      ],
    },
  );

  await user.click(
    await view.findByRole("button", {
      name: /^Edit Sonnet 5\.5 · Low reasoning · /,
    }),
  );

  await user.click(view.getByRole("combobox", { name: "Reasoning: Low" }));
  assert.ok(await view.findByText(/a choice here applies to this task only/));
  await user.click(await view.findByRole("option", { name: "High" }));

  expect(saveProfileSetting).not.toHaveBeenCalled();

  await user.type(
    view.getByRole("textbox", { name: "Task message" }),
    "Ship it{Enter}",
  );

  await waitFor(() => assert.equal(start.mock.calls.length, 1));

  expect(start.mock.calls[0]?.[0]).toMatchObject({
    model: "",
    reasoning_effort: "high",
  });
});

test("a read-only profile starts in plan mode, and switching profiles resets a chosen mode", async () => {
  const { view, user, start } = setup();

  await user.click(
    view.getByRole("combobox", { name: "Profile: Implementer" }),
  );

  await user.click(await view.findByRole("option", { name: "Reviewer" }));

  assert.ok(view.getByRole("button", { name: /· Plan$/ }));
  await user.click(view.getByRole("button", { name: /^Edit / }));

  await user.click(
    await view.findByRole("combobox", { name: "Permission mode: Plan" }),
  );

  await user.click(
    await view.findByRole("option", { name: "Default — ask for approval" }),
  );

  await user.click(view.getByRole("combobox", { name: "Profile: Reviewer" }));

  await user.click(await view.findByRole("option", { name: "Researcher" }));

  assert.ok(view.getByRole("combobox", { name: "Permission mode: Plan" }));

  await user.type(
    view.getByRole("textbox", { name: "Task message" }),
    "Review it{Enter}",
  );

  await waitFor(() =>
    assert.equal(start.mock.calls[0]?.[0].permission_mode, "plan"),
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
