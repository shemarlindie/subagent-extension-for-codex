// @vitest-environment jsdom
import assert from "node:assert/strict";

import { Tooltip } from "@base-ui/react/tooltip";
import { cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { onTestFinished, test, vi } from "vitest";

import { Controller } from "../../../app/state/controller";
import { ControllerContext } from "../../../app/state/controller-context";
import type { Task, Transport } from "../../../app/state/types";
import { TaskMenu } from "./task-menu";

const task: Task = {
  id: "task-1",
  repository: "/repo",
  revision: "HEAD",
  provider: "claude",
  worker_profile: "reviewer",
  title: "Review",
  description: "Review",
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

// Deleting interrupts a running task first; only another action waits.
test("task menu disables deletion while another action runs", async () => {
  onTestFinished(cleanup);

  const controller = new Controller(
    { embedded: true, dispose() {} } as unknown as Transport,
    { hidden: () => false, wide: () => false },
  );

  onTestFinished(() => controller.dispose());
  const snapshot = { ...controller.getSnapshot(), busy: true };
  vi.spyOn(controller, "getSnapshot").mockReturnValue(snapshot);

  const view = render(
    <ControllerContext.Provider value={controller}>
      <Tooltip.Provider>
        <TaskMenu task={task} />
      </Tooltip.Provider>
    </ControllerContext.Provider>,
  );

  const user = userEvent.setup();
  await user.click(view.getByRole("button", { name: "Task actions" }));
  const action = await view.findByRole("menuitem", { name: "Delete task" });
  assert.equal(action.getAttribute("aria-disabled"), "true");
  await user.click(action);
  assert.equal(controller.getSnapshot().dialog, undefined);
});
