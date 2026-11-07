// @vitest-environment jsdom
import assert from "node:assert/strict";

import { act, fireEvent, waitFor } from "@testing-library/react";
import { expect, onTestFinished, test, vi } from "vitest";

import type { ChatItem } from "../../../../shared/tasks/conversation/chat";
import type { Task } from "../../../app/state/types";
import { noteItems, scrollIntoHistory, setup } from "./chat-panel-test-harness";

const replyItems = (): ChatItem[] => [
  {
    kind: "message",
    id: "response",
    event_id: 7,
    message: {
      id: "response",
      event_id: 7,
      timestamp: "2026-10-09T12:00:00Z",
      turn: 1,
      from: "worker",
      kind: "message",
      text: "Response text",
    },
  },
  {
    kind: "outcome",
    id: "outcome",
    event_id: 8,
    timestamp: "2026-10-09T12:00:01Z",
    turn: 1,
    outcome: "completed",
    runtime_ms: 1000,
    cost_usd: 0,
  },
];

test("marking unread from another reply moves the New divider without leaving a copy behind", async () => {
  const second = replyItems().map((item) => ({
    ...item,
    id: `${item.id}-2`,
    event_id: item.event_id + 2,
    ...(item.kind === "message" && {
      message: { ...item.message, id: "response-2", event_id: 9, turn: 2 },
    }),
    ...(item.kind === "outcome" && { turn: 2 }),
  })) as ChatItem[];

  const { view } = setup({}, [], [...replyItems(), ...second]);

  const [first, last] = view.getAllByRole("button", {
    name: "Mark unread from here",
  });

  assert.ok(first && last);
  fireEvent.click(first);
  await waitFor(() => view.getByRole("separator", { name: "New messages" }));
  fireEvent.click(last);

  // Without Web Animations, the divider it left is removed at once.
  await waitFor(() => {
    const dividers = view.container.querySelectorAll(".new-messages-divider");
    assert.equal(dividers.length, 1);

    assert.equal(
      dividers[0]?.nextElementSibling?.getAttribute("data-chat-item"),
      "response-2",
    );
  });
});

test("marking unread from a reply scrolls its New divider into view only when it is out of view", async () => {
  // Just below the 200 px viewport; the history scrolls at most 400 px.
  let dividerTop = 200;

  const bounds = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement) {
      const rect = (top: number, height: number) =>
        ({
          top,
          bottom: top + height,
          left: 0,
          right: 300,
          width: 300,
          height,
        }) as DOMRect;

      if (this.classList.contains("chat-timeline")) return rect(0, 200);

      if (this.getAttribute("data-chat-item") === "new-messages") {
        return rect(dividerTop, 20);
      }

      return rect(0, 0);
    });

  onTestFinished(() => bounds.mockRestore());

  const { view } = setup({}, [], replyItems());
  scrollIntoHistory(view);

  const history = view.getByRole("region", { name: "Chat history" });
  const before = history.scrollTop;

  fireEvent.click(view.getByRole("button", { name: "Mark unread from here" }));

  await waitFor(() => assert.equal(history.scrollTop - before, 200));

  dividerTop = 60;
  scrollIntoHistory(view);
  const shown = history.scrollTop;

  // A second mark whose divider is already in view leaves the reader where they are.
  fireEvent.click(view.getByRole("button", { name: "Mark unread from here" }));

  await act(async () => {});
  assert.equal(history.scrollTop, shown);
});

const markReadCalls = (tool: ReturnType<typeof setup>["tool"]) =>
  tool.mock.calls.filter(([name]) => name === "app_set_task_read");

test("list fetches keep the task read only while Chat is at its latest message", async () => {
  const { controller, task, view } = setup({}, [], noteItems);
  const listed: Task[] = [{ ...task, unread: true, read_through: 2 }];

  await waitFor(() =>
    assert.equal(
      controller.taskActions.unread.settle(listed)[0]?.unread,
      undefined,
    ),
  );

  scrollIntoHistory(view);
  assert.equal(controller.taskActions.unread.settle(listed), listed);
});

test("a hidden panel marks nothing read until it is shown", async () => {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: true,
  });

  onTestFinished(() => {
    Reflect.deleteProperty(document, "hidden");
  });

  const { tool } = setup({ unread: true }, [], noteItems);
  await act(async () => {});
  assert.deepEqual(markReadCalls(tool), []);

  Reflect.deleteProperty(document, "hidden");

  act(() => {
    document.dispatchEvent(new window.Event("visibilitychange"));
  });

  await waitFor(() => assert.equal(markReadCalls(tool).length, 1));
});

const failureNotes = noteItems.map((_, index): ChatItem => ({
  kind: "note",
  id: `note-${index}`,
  event_id: index,
  timestamp: "",
  note: "failure",
  text: `Failure ${index}`,
}));

test("marking the open task read removes its New divider", async () => {
  const { controller, task, view, reopen } = setup(
    { unread: true, read_through: 3 },
    [],
    failureNotes,
  );

  view.getByRole("separator", { name: "New messages" });

  (controller as unknown as { patch(patch: object): void }).patch({
    selected: task.id,
  });

  await act(() => controller.taskActions.unread.markRead(task));
  expect(view.queryByRole("separator", { name: "New messages" })).toBeNull();

  // The mark belongs to that opening; unread again later, the task divides anew.
  reopen({ unread: true, read_through: 3 });
  expect(view.getByRole("separator", { name: "New messages" })).toBeTruthy();
});

test.each([
  {
    name: "a task just marked unread, before the service gives its marker,",
    task: { unread: true },
  },
] satisfies { name: string; task: Partial<Task> }[])(
  "$name opens without a New divider",
  ({ task }) => {
    const { view } = setup(task, [], noteItems);

    expect(view.queryByRole("separator", { name: "New messages" })).toBeNull();
  },
);

test("a task marked unread with nothing new opens without a divider, and a later reply adds none", () => {
  const { controller, view, updateTask } = setup(
    { unread: true, read_through: noteItems.length },
    [],
    noteItems,
  );

  expect(view.queryByRole("separator", { name: "New messages" })).toBeNull();

  const later: ChatItem = {
    kind: "note",
    id: "later",
    event_id: noteItems.length + 1,
    timestamp: "",
    note: "failure",
    text: "Later failure",
  };

  const snapshot = controller.getSnapshot();

  vi.mocked(controller.getSnapshot).mockReturnValue({
    ...snapshot,
    chat: {
      task: "task-1",
      items: [...noteItems, later],
      cursor: later.event_id,
    },
  });

  updateTask({ unread: true });
  expect(view.getByText("Later failure")).toBeTruthy();
  expect(view.queryByRole("separator", { name: "New messages" })).toBeNull();
});
