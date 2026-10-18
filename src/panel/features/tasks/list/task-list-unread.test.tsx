// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, fireEvent, render } from "@testing-library/react";
import { expect, onTestFinished, test, vi } from "vitest";

import { Controller } from "../../../app/state/controller";
import { ControllerContext } from "../../../app/state/controller-context";
import { task } from "../../../app/state/controller-test-harness";
import type { Snapshot, Transport } from "../../../app/state/types";
import { TaskList } from "./task-list";

function setup(patch: Partial<Snapshot>) {
  onTestFinished(cleanup);

  const controller = new Controller(
    { embedded: true, dispose() {} } as unknown as Transport,
    { hidden: () => false, wide: () => false },
  );

  onTestFinished(() => controller.dispose());

  const snapshot: Snapshot = {
    ...controller.getSnapshot(),
    connected: true,
    taskListLoading: false,
    tasks: [
      { ...task("a"), unread: true },
      { ...task("b"), unread: true },
      task("c"),
    ],
    filter: "unread",
    ...patch,
  };

  vi.spyOn(controller, "getSnapshot").mockReturnValue(snapshot);
  const tool = vi.spyOn(controller, "tool").mockResolvedValue({});

  const view = render(
    <ControllerContext.Provider value={controller}>
      <TaskList />
    </ControllerContext.Provider>,
  );

  return { tool, view };
}

test("under Unread, Mark all read takes Clear filter's place and marks the listed tasks read", () => {
  const { tool, view } = setup({});
  expect(view.queryByRole("button", { name: "Clear filter" })).toBeNull();

  fireEvent.click(view.getByRole("button", { name: "Mark all read" }));

  assert.deepEqual(tool.mock.calls, [
    ["app_mark_tasks_read", { task_ids: ["a", "b"] }],
  ]);
});

test("with a search to clear, Unread shows both actions", () => {
  const { view } = setup({ search: "review" });
  expect(view.getByRole("button", { name: "Mark all read" })).toBeTruthy();
  expect(view.getByRole("button", { name: "Clear filter" })).toBeTruthy();
});

test("with nothing unread, Unread says so and offers no Mark all read", () => {
  const { view } = setup({ tasks: [task("c")] });
  expect(view.queryByRole("button", { name: "Mark all read" })).toBeNull();
  expect(view.getByText("You're all caught up.")).toBeTruthy();
});
