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
  depends_on: [],
  context: [],
  workspace_strategy: "worktree",
  budget: { max_runtime_minutes: 20, max_cost_usd: null },
  owner: "owner",
  status: "completed",
  created_at: "",
  updated_at: "",
  instructions: [],
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
  const back = vi.spyOn(controller, "back");

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

  return { controller, tool, refresh, back, view, input };
}

test("inline title saves trimmed text through the rename tool before refreshing", async (t) => {
  const { controller, tool, refresh, back, view, input } = setup();
  t.onTestFinished(() => controller.dispose());
  fireEvent.change(input, { target: { value: "  Updated title  " } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(view.queryByRole("textbox")).toBeNull());

  assert.deepEqual(tool.mock.calls, [
    ["rename_user_agent_task", { task_id: task.id, title: "Updated title" }],
  ]);

  assert.equal(refresh.mock.calls.length, 1);

  const [renameOrder] = tool.mock.invocationCallOrder;
  const [refreshOrder] = refresh.mock.invocationCallOrder;
  assert.ok(renameOrder !== undefined && refreshOrder !== undefined);
  assert.ok(renameOrder < refreshOrder);

  assert.equal(back.mock.calls.length, 0);
  assert.equal(task.description, "Review the full authentication workflow.");
});

test("inline title keeps a failed edit for retry and refreshes only after success", async (t) => {
  const { controller, tool, refresh, view, input } = setup();
  t.onTestFinished(() => controller.dispose());
  tool.mockRejectedValueOnce(new Error("Rename failed"));
  fireEvent.change(input, { target: { value: "Retry title" } });
  fireEvent.keyDown(input, { key: "Enter" });

  await waitFor(() =>
    assert.equal(view.getByRole("alert").textContent, "Rename failed"),
  );

  assert.equal(input.value, "Retry title");
  assert.equal(refresh.mock.calls.length, 0);
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(view.queryByRole("textbox")).toBeNull());
  assert.equal(tool.mock.calls.length, 2);
  assert.equal(refresh.mock.calls.length, 1);
});
