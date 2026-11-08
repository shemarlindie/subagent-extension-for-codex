// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { Controller } from "../../../app/state/controller";
import { ControllerContext } from "../../../app/state/controller-context";
import type { Task, Transport } from "../../../app/state/types";
import { TaskTitle } from "./task-title";

afterEach(cleanup);

const task: Task = {
  id: "task-1",
  repository: "/repo",
  revision: "HEAD",
  provider: "claude",
  worker_profile: "reviewer",
  title: "Review",
  description: "Review the full authentication workflow.",
  workspace_strategy: "worktree",
  budget: { max_runtime_minutes: 20, max_cost_usd: null },
  owner: "owner",
  status: "completed",
  created_at: "",
  updated_at: "",
  created_by: "user",
  instructions_sent: 0,
  pending_steers: [],
  queue: [],
  turn: 1,
  runtime_ms: 0,
};

function setup() {
  const controller = new Controller(
    { embedded: true, dispose() {} } as Transport,
    { hidden: () => false, wide: () => false },
  );

  const tool = vi.spyOn(controller, "tool").mockResolvedValue({});
  const refresh = vi.spyOn(controller, "refresh").mockResolvedValue();

  const view = render(
    <ControllerContext.Provider value={controller}>
      <TaskTitle task={task} />
    </ControllerContext.Provider>,
  );

  fireEvent.click(
    view.getByRole("button", { name: "Edit task title: Review" }),
  );

  const input = view.getByRole("textbox", {
    name: "Task title",
  }) as HTMLInputElement;

  return { controller, tool, refresh, view, input };
}

test("inline title trims submissions, keeps a failed edit for retry and refreshes only after success", async (t) => {
  const { controller, tool, refresh, view, input } = setup();
  t.onTestFinished(() => controller.dispose());
  tool.mockRejectedValueOnce(new Error("Rename failed"));
  fireEvent.change(input, { target: { value: "  Retry title  " } });
  fireEvent.keyDown(input, { key: "Enter" });

  await waitFor(() =>
    assert.equal(view.getByRole("alert").textContent, "Rename failed"),
  );

  assert.equal(input.value, "  Retry title  ");

  assert.deepEqual(tool.mock.calls[0], [
    "app_rename_task",
    { task_id: task.id, title: "Retry title" },
  ]);

  assert.equal(refresh.mock.calls.length, 0);
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(view.queryByRole("textbox")).toBeNull());
  assert.equal(tool.mock.calls.length, 2);
  assert.equal(refresh.mock.calls.length, 1);
});
