// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";

import { Controller } from "../../../app/state/controller";
import { ControllerContext } from "../../../app/state/controller-context";
import { task } from "../../../app/state/controller-test-harness";
import type { Task, Transport } from "../../../app/state/types";
import { ProjectArchive } from "./project-archive";

const archived = (id: string, at: string): Task => ({
  ...task(id),
  status: "completed",
  title: `Task ${id}`,
  archived_at: at,
});

function setup() {
  onTestFinished(cleanup);

  const controller = new Controller(
    { embedded: true, dispose() {} } as unknown as Transport,
    { hidden: () => false, wide: () => false },
  );

  onTestFinished(() => controller.dispose());

  vi.spyOn(controller, "getSnapshot").mockReturnValue({
    ...controller.getSnapshot(),
    connected: true,
  });

  vi.spyOn(controller, "refresh").mockResolvedValue();

  const tool = vi
    .spyOn(controller, "tool")
    .mockImplementation((name: string) =>
      Promise.resolve(
        name === "list_agent_tasks"
          ? [
              archived("old", "2026-01-01T00:00:00Z"),
              task("listed"),
              archived("new", "2026-02-01T00:00:00Z"),
            ]
          : { task_ids: ["new"], skipped: [] },
      ),
    );

  const view = render(
    <ControllerContext.Provider value={controller}>
      <ProjectArchive repository="/repo/a" name="Alpha" onBack={() => {}} />
    </ControllerContext.Provider>,
  );

  const calls = () =>
    tool.mock.calls.filter(([name]) => name !== "list_agent_tasks");

  return { view, calls };
}

test("a project's archive lists its archived tasks and unarchives the selected ones", async () => {
  const { view, calls } = setup();
  const list = await view.findByRole("list", { name: "Archived tasks" });

  expect(
    [...list.querySelectorAll("[data-task]")].map(
      (row) => (row as HTMLElement).dataset.task,
    ),
  ).toEqual(["new", "old"]);

  await userEvent.click(view.getByText("Task new"));
  expect(view.getByText("1 of 2 selected")).not.toBeNull();

  await userEvent.click(
    view.getByRole("button", { name: "Unarchive selected" }),
  );

  assert.deepEqual(calls(), [
    ["set_user_agent_tasks_archived", { task_ids: ["new"], archived: false }],
  ]);
});

test("deleting all asks first, with the choice to delete the agent tasks", async () => {
  const { view, calls } = setup();
  await view.findByRole("list", { name: "Archived tasks" });

  await userEvent.click(view.getByRole("button", { name: "Delete all" }));
  assert.deepEqual(calls(), []);

  await userEvent.click(
    view.getByRole("switch", { name: "Also delete the agent tasks" }),
  );

  await userEvent.click(view.getByRole("button", { name: "Delete 2 tasks" }));

  await waitFor(() =>
    assert.deepEqual(calls(), [
      [
        "delete_user_agent_tasks",
        { task_ids: ["new", "old"], delete_agent_task: true },
      ],
    ]),
  );
});
