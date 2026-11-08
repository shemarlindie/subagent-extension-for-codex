// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { onTestFinished, test, vi } from "vitest";

import { Controller } from "../../../app/state/controller";
import { ControllerContext } from "../../../app/state/controller-context";
import { task } from "../../../app/state/controller-test-harness";
import type { Snapshot, Task, Transport } from "../../../app/state/types";
import { TaskList } from "./task-list";

const done = (id: string, patch: Partial<Task> = {}): Task => ({
  ...task(id),
  status: "completed",
  ...patch,
});

function setup(patch: Partial<Snapshot>) {
  onTestFinished(cleanup);

  const controller = new Controller(
    { embedded: true, dispose() {} } as unknown as Transport,
    { hidden: () => false, wide: () => false },
  );

  onTestFinished(() => controller.dispose());

  vi.spyOn(controller, "getSnapshot").mockReturnValue({
    ...controller.getSnapshot(),
    connected: true,
    taskListLoading: false,
    ...patch,
  });

  const tool = vi
    .spyOn(controller, "tool")
    .mockResolvedValue({ task_ids: [], skipped: [] });

  const view = render(
    <ControllerContext.Provider value={controller}>
      <TaskList />
    </ControllerContext.Provider>,
  );

  return { tool, view };
}

const openMenu = async (view: ReturnType<typeof render>, name: string) => {
  await userEvent.click(
    view.getByRole("button", { name: `Actions for ${name}` }),
  );
};

test.each([
  ["Archive completed", ["a", "b"]],
  ["Archive all", ["a", "b", "failed"]],
])(
  "a project's header menu item %s archives its tasks in scope, whatever the search shows",
  async (item, archived) => {
    const { tool, view } = setup({
      tasks: [
        done("a", { title: "Parser" }),
        done("b", { title: "Lexer" }),
        task("busy"),
        done("failed", { status: "failed" }),
        done("old", { archived_at: "then" }),
        done("elsewhere", { repository: "/repo/b" }),
      ],
      filter: "all",
      search: "parser",
    });

    await openMenu(view, "a");
    await userEvent.click(await view.findByRole("menuitem", { name: item }));

    assert.deepEqual(tool.mock.calls, [
      ["app_set_tasks_archived", { task_ids: archived, archived: true }],
    ]);
  },
);

test("a project's header menu reads the read completed tasks the list left out before archiving", async () => {
  const { tool, view } = setup({
    tasks: [task("busy"), done("listed")],
    readCompleted: { "/repo/a": 1 },
    filter: "active",
  });

  tool.mockImplementation((name) =>
    Promise.resolve(
      name === "app_list_tasks"
        ? { tasks: [task("busy"), done("listed"), done("read")] }
        : { task_ids: [], skipped: [] },
    ),
  );

  await openMenu(view, "a");

  await userEvent.click(
    await view.findByRole("menuitem", { name: "Archive completed" }),
  );

  assert.deepEqual(tool.mock.calls, [
    [
      "app_list_tasks",
      {
        conversation_id: null,
        repository: "/repo/a",
        include_read_completed: true,
      },
    ],
    [
      "app_set_tasks_archived",
      { task_ids: ["listed", "read"], archived: true },
    ],
  ]);
});
