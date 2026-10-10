// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { expect, onTestFinished, test, vi } from "vitest";

import type { Controller } from "../../../app/state/controller";
import { ControllerContext } from "../../../app/state/controller-context";
import type { Snapshot, Task } from "../../../app/state/types";
import { InlinePermissionRequest } from "./inline-permission-request";

test("permission request is actionable inline with a focused optional message", async () => {
  onTestFinished(cleanup);

  const snapshot = { busy: false } as Snapshot;
  const decidePermission = vi.fn().mockResolvedValue(undefined);

  const controller = {
    subscribe: () => () => {},
    getSnapshot: () => snapshot,
    decidePermission,
  } as unknown as Controller;

  const task: Task = {
    id: "task-1",
    repository: "/repo",
    revision: "HEAD",
    provider: "claude",
    worker_profile: "debugger",
    title: "Test permission request",
    description: "Test permission request rendering.",
    depends_on: [],
    context: [],
    workspace_strategy: "worktree",
    budget: { max_runtime_minutes: 20, max_cost_usd: 5 },
    owner: "owner",
    status: "waiting",
    created_at: "",
    updated_at: "",
    instructions: [],
    created_by: "user",
    instructions_sent: 0,
    pending_steers: [],
    queue: [],
    turn: 1,
    runtime_ms: 0,
    pending_input: {
      id: "permission-1",
      tool: "Bash",
      kind: "permission",
      input: {
        command: "npm run typecheck",
        description: "Run the checks.",
      },
    },
  };

  const view = render(
    <ControllerContext.Provider value={controller}>
      <InlinePermissionRequest task={task} />
    </ControllerContext.Provider>,
  );

  assert.ok(view.getByRole("heading", { name: "Bash" }));
  assert.ok(view.getByText("Permission request"));
  assert.ok(view.getByText("Command"));
  assert.equal(view.getByText("npm run typecheck").tagName, "CODE");
  assert.ok(view.getByRole("button", { name: "Deny" }));
  assert.ok(view.getByRole("button", { name: "Approve this request once" }));

  const trigger = view.getByRole("button", { name: "Add a message" });
  fireEvent.click(trigger);
  assert.equal(trigger.getAttribute("aria-expanded"), "true");

  const message = await view.findByRole("textbox", {
    name: "Optional message to worker",
  });

  assert.equal((message as HTMLInputElement).type, "text");
  await waitFor(() => expect(document.activeElement).toBe(message));

  fireEvent.change(message, { target: { value: "Run only the checks." } });

  fireEvent.click(
    view.getByRole("button", { name: "Approve this request once" }),
  );

  await waitFor(() =>
    expect(decidePermission).toHaveBeenCalledWith(
      task,
      true,
      "Run only the checks.",
    ),
  );
});
