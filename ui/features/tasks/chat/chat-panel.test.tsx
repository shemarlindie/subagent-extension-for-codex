// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { onTestFinished, test, vi } from "vitest";

import { Controller } from "../../../shared/state/controller";
import { ControllerContext } from "../../../shared/state/controller-context";
import type { Task, Transport } from "../../../shared/state/types";
import { ChatPanel } from "./chat-panel";

const base: Task = {
  id: "task-1",
  repository: "/repo",
  revision: "HEAD",
  provider: "claude",
  worker_profile: "implementer",
  title: "Implement",
  description: "Implement the change",
  depends_on: [],
  context: [],
  workspace_strategy: "worktree",
  budget: { max_runtime_minutes: 20, max_cost_usd: 5 },
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
  runtime_ms: 60000,
  cost_usd: 1,
};

function setup(patch: Partial<Task> = {}) {
  onTestFinished(cleanup);
  const task = { ...base, ...patch };

  const controller = new Controller(
    { embedded: true, dispose() {} } as unknown as Transport,
    { hidden: () => false, wide: () => false },
  );

  onTestFinished(() => controller.dispose());
  const tool = vi.spyOn(controller, "tool").mockResolvedValue({});
  vi.spyOn(controller, "refresh").mockResolvedValue();

  const view = render(
    <ControllerContext.Provider value={controller}>
      <ChatPanel task={task} />
    </ControllerContext.Provider>,
  );

  const composer = view.getByRole("textbox", { name: "Message" });

  const type = (text: string) =>
    fireEvent.change(composer, { target: { value: text } });

  return { controller, task, tool, view, composer, type };
}

const sent = (tool: ReturnType<typeof setup>["tool"]) =>
  tool.mock.calls.map(([name, args]) => [name, args]);

test("on an idle task, Enter sends the message, which starts the next turn", async () => {
  const { tool, composer, type, view } = setup();
  type("Next, add tests");
  fireEvent.keyDown(composer, { key: "Enter" });

  await waitFor(() =>
    assert.deepEqual(sent(tool), [
      [
        "send_user_agent_message",
        { task_id: "task-1", message: "Next, add tests", delivery: "steer" },
      ],
    ]),
  );

  await waitFor(() =>
    assert.equal((composer as HTMLTextAreaElement).value, ""),
  );

  // Shift+Enter is a new line, and Tab and Esc keep their usual roles.
  type("Two");
  fireEvent.keyDown(composer, { key: "Enter", shiftKey: true });
  fireEvent.keyDown(composer, { key: "Tab" });
  fireEvent.keyDown(composer, { key: "Escape" });
  assert.equal(tool.mock.calls.length, 1);
  assert.ok(view.getByRole("button", { name: "Send" }));
});

test("while a turn runs, Enter steers, Tab queues and Esc stops, and an empty composer offers Stop", async () => {
  const { tool, composer, type, view } = setup({ status: "running" });
  assert.ok(view.getByRole("button", { name: "Stop the turn" }));

  type("Mind the edge cases");
  assert.ok(view.getByRole("button", { name: "Steer" }));
  assert.ok(view.getByRole("button", { name: "Queue" }));
  fireEvent.keyDown(composer, { key: "Enter" });
  await waitFor(() => assert.equal(tool.mock.calls.length, 1));

  await waitFor(() =>
    assert.equal((composer as HTMLTextAreaElement).value, ""),
  );

  type("Afterwards, the docs");
  fireEvent.keyDown(composer, { key: "Tab" });
  await waitFor(() => assert.equal(tool.mock.calls.length, 2));

  fireEvent.keyDown(composer, { key: "Escape" });
  await waitFor(() => assert.equal(tool.mock.calls.length, 3));

  assert.deepEqual(sent(tool), [
    [
      "send_user_agent_message",
      { task_id: "task-1", message: "Mind the edge cases", delivery: "steer" },
    ],
    [
      "send_user_agent_message",
      { task_id: "task-1", message: "Afterwards, the docs", delivery: "queue" },
    ],
    ["interrupt_agent_task", { task_id: "task-1", send_pending: false }],
  ]);
});

test("while the worker waits for input, Enter only queues", async () => {
  const { tool, composer, type, view } = setup({
    status: "waiting",
    pending_input: { id: "r", tool: "Bash", kind: "permission", input: {} },
  });

  type("Later");
  assert.equal(view.queryByRole("button", { name: "Steer" }), null);
  fireEvent.keyDown(composer, { key: "Enter" });

  await waitFor(() =>
    assert.deepEqual(sent(tool), [
      [
        "send_user_agent_message",
        { task_id: "task-1", message: "Later", delivery: "queue" },
      ],
    ]),
  );
});

test("pending steers can be sent now, and a paused queue resumed, cleared, edited and trimmed", async () => {
  const { tool, view } = setup({
    status: "running",
    pending_steers: [{ id: "msg_p", message: "Pending", from: "user" }],
    queue: [
      { id: "msg_q", message: "Queued", from: "user", delivery: "queue" },
      {
        id: "msg_l",
        message: "Left over",
        from: "parent",
        delivery: "steer",
        recorded: true,
      },
    ],
    queue_paused: true,
  });

  assert.ok(view.getByText("Sent after the next tool call"));
  assert.ok(view.getByText("Queue paused · 2"));
  // A steer the worker already has keeps its text.
  assert.equal(view.getAllByRole("button", { name: "Edit" }).length, 1);

  const click = async (name: string, index = 0) => {
    const count = tool.mock.calls.length;
    fireEvent.click(view.getAllByRole("button", { name })[index]);
    await waitFor(() => assert.equal(tool.mock.calls.length, count + 1));
  };

  await click("Interrupt and send now");
  await click("Resume");
  await click("Clear");
  await click("Remove", 1);

  fireEvent.click(view.getByRole("button", { name: "Edit" }));
  const edit = view.getByRole("textbox", { name: "Queued message" });
  fireEvent.change(edit, { target: { value: "Edited" } });
  await click("Save");

  assert.deepEqual(sent(tool), [
    ["interrupt_agent_task", { task_id: "task-1", send_pending: true }],
    ["resume_user_agent_queue", { task_id: "task-1" }],
    ["clear_user_agent_queue", { task_id: "task-1" }],
    [
      "remove_user_agent_queued_message",
      { task_id: "task-1", message_id: "msg_l" },
    ],
    [
      "edit_user_agent_queued_message",
      { task_id: "task-1", message_id: "msg_q", message: "Edited" },
    ],
  ]);
});

test("a spent budget shows its amounts, and the next message raises it", async () => {
  const { tool, composer, type, view } = setup({
    status: "failed",
    error: "Claude result: error_max_budget_usd",
    cost_usd: 5.02,
  });

  assert.match(view.container.textContent ?? "", /Used \$5\.02 of \$5\.00/);

  fireEvent.change(view.getByRole("spinbutton", { name: "Cost limit ($)" }), {
    target: { value: "8" },
  });

  type("Carry on");
  fireEvent.keyDown(composer, { key: "Enter" });

  await waitFor(() =>
    assert.deepEqual(sent(tool), [
      [
        "send_user_agent_message",
        {
          task_id: "task-1",
          message: "Carry on",
          delivery: "steer",
          budget: { max_cost_usd: 8 },
        },
      ],
    ]),
  );
});

test("a failed send keeps the draft and shows why", async () => {
  const { tool, composer, type, view } = setup();
  tool.mockRejectedValueOnce(new Error("The task is being deleted"));
  type("Keep me");
  fireEvent.keyDown(composer, { key: "Enter" });

  await waitFor(() =>
    assert.equal(
      view.getByRole("alert").textContent,
      "The task is being deleted",
    ),
  );

  assert.equal((composer as HTMLTextAreaElement).value, "Keep me");
});
