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
      { ...task("a"), unseen: true },
      { ...task("b"), unseen: true },
      task("c"),
    ],
    filter: "unseen",
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

test("under Unseen, Mark all seen takes Clear filter's place and sees the listed tasks", () => {
  const { tool, view } = setup({});
  expect(view.queryByRole("button", { name: "Clear filter" })).toBeNull();

  fireEvent.click(view.getByRole("button", { name: "Mark all seen" }));

  assert.deepEqual(tool.mock.calls, [
    ["mark_user_agent_tasks_seen", { task_ids: ["a", "b"] }],
  ]);
});

test("with a search to clear, Unseen shows both actions", () => {
  const { view } = setup({ search: "review" });
  expect(view.getByRole("button", { name: "Mark all seen" })).toBeTruthy();
  expect(view.getByRole("button", { name: "Clear filter" })).toBeTruthy();
});

test("with nothing unseen, Unseen says so and offers no Mark all seen", () => {
  const { view } = setup({ tasks: [task("c")] });
  expect(view.queryByRole("button", { name: "Mark all seen" })).toBeNull();
  expect(view.getByText("You're all caught up.")).toBeTruthy();
});
