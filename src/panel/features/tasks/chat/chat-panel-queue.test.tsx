// @vitest-environment jsdom
import assert from "node:assert/strict";

import { fireEvent, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { sent, setup } from "./chat-panel-test-harness";

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

  assert.ok(view.getByText("Steer"));
  assert.ok(view.getByText("Queue paused · 2"));
  // A steer the worker already has keeps its text.
  assert.equal(view.getAllByRole("button", { name: "Edit" }).length, 1);

  const click = async (name: string, index = 0) => {
    const count = tool.mock.calls.length;
    const button = view.getAllByRole("button", { name })[index];
    assert.ok(button, `No ${name} button at index ${index}`);
    fireEvent.click(button);
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

  expect(sent(tool)).toEqual([
    ["interrupt_task", { task_id: "task-1", send_pending: true }],
    ["app_resume_queue", { task_id: "task-1" }],
    ["app_clear_queue", { task_id: "task-1" }],
    ["app_remove_queued_message", { task_id: "task-1", message_id: "msg_l" }],
    [
      "app_edit_queued_message",
      { task_id: "task-1", message_id: "msg_q", message: "Edited" },
    ],
  ]);
});

test("a running task can steer an existing queued message, keeping its composer draft", async () => {
  const { tool, view, type, composer } = setup({
    status: "running",
    queue: [
      { id: "msg_q", message: "Queued", from: "parent", delivery: "queue" },
      {
        id: "msg_l",
        message: "Left over",
        from: "user",
        delivery: "steer",
        recorded: true,
      },
    ],
  });

  type("An unsent draft");
  const row = view.container.querySelector('[data-message="msg_q"]')!;
  const recorded = view.container.querySelector('[data-message="msg_l"]')!;

  const button = row.querySelector<HTMLButtonElement>(
    'button[aria-label="Steer"]',
  );

  expect(button).not.toBeNull();
  expect(recorded.querySelector('button[aria-label="Steer"]')).toBeNull();
  fireEvent.click(button!);

  await waitFor(() =>
    expect(sent(tool)).toEqual([
      ["app_steer_queued_message", { task_id: "task-1", message_id: "msg_q" }],
    ]),
  );

  expect((composer as HTMLTextAreaElement).value).toBe("An unsent draft");

  fireEvent.click(
    row.querySelector<HTMLButtonElement>('button[aria-label="Edit"]')!,
  );

  expect(row.querySelector('button[aria-label="Steer"]')).toBeNull();
});

test.each([
  { status: "completed" as const },
  { status: "interrupted" as const, queue_paused: true },
  {
    status: "waiting" as const,
    pending_input: {
      id: "request",
      kind: "question" as const,
      tool: "question",
      input: { question: "Continue?" },
    },
  },
])(
  "queued steering stays hidden when the composer cannot steer: $status",
  (patch) => {
    const { view } = setup({
      ...patch,
      queue: [
        { id: "msg_q", message: "Queued", from: "user", delivery: "queue" },
      ],
    });

    const row = view.container.querySelector('[data-message="msg_q"]')!;
    expect(row.querySelector('button[aria-label="Steer"]')).toBeNull();
  },
);

test("queued messages reorder by dragging or Alt+arrows, behind a left-over steer", async () => {
  const queued = (id: string, message: string) => ({
    id,
    message,
    from: "user" as const,
    delivery: "queue" as const,
  });

  const { tool, view } = setup({
    status: "running",
    queue: [
      { ...queued("msg_l", "Left over"), delivery: "steer", recorded: true },
      queued("msg_a", "A"),
      queued("msg_b", "B"),
      queued("msg_c", "C"),
    ],
  });

  const row = (id: string) =>
    view.container.querySelector<HTMLElement>(`[data-message="${id}"]`)!;

  // The left-over steer can't move, so its grip slot stays empty.
  assert.equal(row("msg_l").getAttribute("draggable"), "false");
  assert.equal(row("msg_a").getAttribute("draggable"), "true");
  expect(row("msg_l").querySelector(".chat-queue-grip")).toBeTruthy();
  expect(row("msg_l").querySelector(".chat-queue-grip svg")).toBeNull();
  expect(row("msg_a").querySelector(".chat-queue-grip svg")).toBeTruthy();

  const moved = async (count: number) =>
    waitFor(() => assert.equal(tool.mock.calls.length, count));

  // At the top of the movable rows, Alt+Up does nothing.
  fireEvent.keyDown(row("msg_a"), { key: "ArrowUp", altKey: true });
  fireEvent.keyDown(row("msg_a"), { key: "ArrowDown" });
  fireEvent.keyDown(row("msg_a"), { key: "ArrowDown", altKey: true });
  await moved(1);

  // Dropping C over the lower half of the steer lands it first after it.
  const dataTransfer = { setData: vi.fn(), effectAllowed: "" };
  fireEvent.dragStart(row("msg_c"), { dataTransfer });
  assert.ok(row("msg_c").hasAttribute("data-dragging"));
  fireEvent.dragOver(row("msg_l"), { clientY: 100 });
  assert.equal(row("msg_a").dataset.drop, "before");
  fireEvent.drop(row("msg_a"));
  await moved(2);

  // Dropping a row where it already is sends nothing.
  fireEvent.dragStart(row("msg_b"), { dataTransfer });
  fireEvent.dragOver(row("msg_b"), { clientY: 0 });
  fireEvent.drop(row("msg_b"));
  fireEvent.dragEnd(row("msg_b"));
  expect(view.container.querySelector("[data-drop]")).toBeNull();

  expect(sent(tool)).toEqual([
    [
      "app_move_queued_message",
      { task_id: "task-1", message_id: "msg_a", index: 2 },
    ],
    [
      "app_move_queued_message",
      { task_id: "task-1", message_id: "msg_c", index: 1 },
    ],
  ]);
});
