// @vitest-environment jsdom
import assert from "node:assert/strict";

import { Tooltip } from "@base-ui/react/tooltip";
import { cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { onTestFinished, test, vi } from "vitest";

import { Controller } from "../../../shared/state/controller";
import { ControllerContext } from "../../../shared/state/controller-context";
import type { Task, Transport } from "../../../shared/state/types";
import { TaskMenu } from "./task-menu";

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

test.each([
  "queued",
  "starting",
  "running",
  "waiting",
  "completed",
  "busy",
] as const)("task menu gates deletion for %s tasks", async (status) => {
  onTestFinished(cleanup);

  const controller = new Controller(
    { embedded: true, dispose() {} } as unknown as Transport,
    {
      hidden: () => false,
      wide: () => false,
    },
  );

  onTestFinished(() => controller.dispose());

  const current = {
    ...task,
    status: status === "busy" ? ("completed" as const) : status,
  };

  if (status === "busy") {
    const snapshot = { ...controller.getSnapshot(), busy: true };
    vi.spyOn(controller, "getSnapshot").mockReturnValue(snapshot);
  }

  const view = render(
    <ControllerContext.Provider value={controller}>
      <Tooltip.Provider>
        <TaskMenu task={current} />
      </Tooltip.Provider>
    </ControllerContext.Provider>,
  );

  const user = userEvent.setup();
  await user.click(view.getByRole("button", { name: /More/ }));
  const action = await view.findByRole("menuitem");
  const enabled = status === "completed";
  assert.equal(action.getAttribute("aria-disabled") === "true", !enabled);
  await user.click(action);
  if (enabled) {
    assert.equal(controller.getSnapshot().dialog?.kind, "delete");
    const dialog = controller.getSnapshot().dialog;

    assert.equal(
      dialog && "task" in dialog ? dialog.task.id : undefined,
      task.id,
    );
  } else assert.equal(controller.getSnapshot().dialog, undefined);
});
