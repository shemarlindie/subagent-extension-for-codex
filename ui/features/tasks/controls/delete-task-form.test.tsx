// @vitest-environment jsdom
import assert from "node:assert/strict";

import { Dialog } from "@base-ui/react/dialog";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { onTestFinished, test, vi } from "vitest";

import { Controller } from "../../../shared/state/controller";
import { ControllerContext } from "../../../shared/state/controller-context";
import type { Task, Transport } from "../../../shared/state/types";
import { DeleteTaskForm } from "./delete-task-form";

const task: Task = {
  id: "task-1",
  repository: "/repo",
  revision: "HEAD",
  provider: "claude",
  worker_profile: "reviewer",
  title: "Review",
  description: "Review",
  depends_on: [],
  context: [],
  workspace_strategy: "worktree",
  branch: "agent/task-1",
  budget: { max_runtime_minutes: 20, max_cost_usd: null },
  owner: "owner",
  status: "completed",
  created_at: "",
  updated_at: "",
  instructions: [],
  created_by: "user",
  instructions_sent: 0,
  turn: 1,
  runtime_ms: 0,
};

function setup() {
  const controller = new Controller(
    { embedded: true, dispose() {} } as unknown as Transport,
    {
      hidden: () => false,
      wide: () => false,
    },
  );

  controller.open({ kind: "delete", task });

  const tool = vi
    .spyOn(controller, "tool")
    .mockResolvedValue({ status: "deleted" });

  const back = vi.spyOn(controller, "back");
  vi.spyOn(controller, "refresh").mockResolvedValue();
  const dialog = controller.getSnapshot().dialog;
  if (dialog?.kind !== "delete") throw new Error("Expected deletion dialog");

  const view = render(
    <ControllerContext.Provider value={controller}>
      <Dialog.Root open>
        <DeleteTaskForm dialog={dialog} />
      </Dialog.Root>
    </ControllerContext.Provider>,
  );

  return { controller, tool, back, view };
}

test.each([false, true])(
  "deletion submits the selected provider-session option (%s) and returns after success",
  async (deleteAgentTask) => {
    onTestFinished(cleanup);
    const { controller, tool, back, view } = setup();
    onTestFinished(() => controller.dispose());

    const toggle = view.getByRole("switch", {
      name: "Also delete the agent task",
    });

    assert.equal(toggle.getAttribute("aria-checked"), "false");

    assert.match(
      view.container.textContent ?? "",
      /uncommitted changes included/,
    );

    if (deleteAgentTask) fireEvent.click(toggle);
    fireEvent.click(view.getByRole("button", { name: "Delete task" }));

    await waitFor(() => assert.equal(tool.mock.calls.length, 1));

    assert.deepEqual(tool.mock.calls[0], [
      "delete_user_agent_task",
      { task_id: task.id, delete_agent_task: deleteAgentTask },
    ]);

    await waitFor(() => assert.equal(back.mock.calls.length, 1));
    assert.equal(controller.getSnapshot().dialog, undefined);
  },
);

test("a failed deletion keeps the dialog and option available for retry", async () => {
  onTestFinished(cleanup);
  const { controller, tool, back, view } = setup();
  onTestFinished(() => controller.dispose());
  tool.mockRejectedValue(new Error("Session cleanup failed"));

  fireEvent.click(
    view.getByRole("switch", { name: "Also delete the agent task" }),
  );

  fireEvent.click(view.getByRole("button", { name: "Delete task" }));

  await waitFor(() =>
    assert.equal(view.getByRole("alert").textContent, "Session cleanup failed"),
  );

  assert.equal(controller.getSnapshot().dialog?.kind, "delete");
  assert.equal(back.mock.calls.length, 0);
  assert.equal(view.getByRole("switch").getAttribute("aria-checked"), "true");

  assert.equal(
    (view.getByRole("button", { name: "Delete task" }) as HTMLButtonElement)
      .disabled,
    false,
  );
});
