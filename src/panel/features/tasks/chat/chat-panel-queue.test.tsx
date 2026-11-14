// @vitest-environment jsdom
import assert from "node:assert/strict";

import { fireEvent, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { getElement } from "../../../shared/utils/dom-test-harness";
import { sent, setup } from "./chat-panel-test-harness";

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
  const row = getElement(view.container, '[data-message="msg_q"]');
  const recorded = getElement(view.container, '[data-message="msg_l"]');

  const button = row.querySelector<HTMLButtonElement>(
    'button[aria-label="Steer"]',
  );

  assert.ok(button);
  expect(recorded.querySelector('button[aria-label="Steer"]')).toBeNull();
  expect(recorded.querySelector('button[aria-label="Edit"]')).toBeNull();
  fireEvent.click(button);

  await waitFor(() =>
    expect(sent(tool)).toEqual([
      ["app_steer_queued_message", { task_id: "task-1", message_id: "msg_q" }],
    ]),
  );

  expect((composer as HTMLTextAreaElement).value).toBe("An unsent draft");

  fireEvent.click(
    getElement<HTMLButtonElement>(row, 'button[aria-label="Edit"]'),
  );

  expect(row.querySelector('button[aria-label="Steer"]')).toBeNull();
});

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
    getElement<HTMLElement>(view.container, `[data-message="${id}"]`);

  // The left-over steer stays fixed while queued messages can move.
  assert.equal(row("msg_l").getAttribute("draggable"), "false");
  assert.equal(row("msg_a").getAttribute("draggable"), "true");

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
