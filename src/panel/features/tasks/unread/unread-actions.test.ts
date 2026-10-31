import assert from "node:assert/strict";

import { expect, test, vi } from "vitest";

import { task as taskFixture } from "../../../app/state/controller-test-harness";
import type { Snapshot, Task } from "../../../app/state/types";
import type { UndoEntry } from "../../../app/state/undo-history";
import { undoRecorder } from "../../../app/state/undo-test-harness";
import { UnreadActions } from "./unread-actions";

const task = ({ id, ...patch }: Partial<Task> & { id: string }): Task => ({
  ...taskFixture(id),
  ...patch,
});

function setup(tasks: Task[], selected?: string) {
  let snapshot = { tasks, selected } as Snapshot;

  const tool = vi.fn(
    async (_name: string, _args: Record<string, unknown>) =>
      ({ unread: false, through: 9 }) as never,
  );

  const { recorder, entries } = undoRecorder();

  const actions = new UnreadActions({
    snapshot: () => snapshot,
    closed: () => false,
    patch: (patch) => {
      snapshot = { ...snapshot, ...patch };
    },
    tool,
    report: () => {},
    undo: recorder,
  });

  const unread = () =>
    snapshot.tasks.filter((task) => task.unread).map((task) => task.id);

  return { actions, tool, unread, entries, snapshot: () => snapshot };
}

test("reading sends each Chat cursor once, and only for an unread task", async () => {
  const open = task({ id: "a", unread: true });
  const { actions, tool, unread } = setup([open]);

  await actions.readThrough(open, 4);
  await actions.readThrough(open, 4);
  await actions.readThrough(task({ id: "a" }), 5);

  assert.deepEqual(tool.mock.calls, [
    ["app_set_task_read", { task_id: "a", read: true, through: 4 }],
  ]);

  assert.deepEqual(unread(), []);
});

test("a list fetch keeps the watched task read until Chat reads its new messages", async () => {
  const { actions, tool } = setup([task({ id: "a" })], "a");

  const listed = [
    task({ id: "a", unread: true, read_through: 4 }),
    task({ id: "b", unread: true }),
  ];

  assert.deepEqual(actions.settle(listed), listed);

  actions.watch("a");
  const settled = actions.settle(listed);
  assert.deepEqual(settled[0], task({ id: "a" }));
  assert.equal(settled[1], listed[1]);

  await actions.readThrough(settled[0], 6);

  assert.deepEqual(tool.mock.calls, [
    ["app_set_task_read", { task_id: "a", read: true, through: 6 }],
  ]);
});

test("a list fetch leaves a watched task unread when the user marked it so", async () => {
  const { actions } = setup([task({ id: "a" })], "a");
  await actions.markUnread(task({ id: "a" }));
  actions.watch("a");

  const listed = [task({ id: "a", unread: true })];
  assert.equal(actions.settle(listed), listed);
});

test("an open task marked unread stays unread while the user reads it, until they leave its end", async () => {
  const open = task({ id: "a" });
  const { actions, tool, unread } = setup([open], "a");

  tool.mockResolvedValueOnce({ unread: true, through: 9 } as never);
  await actions.markUnread(open);
  assert.deepEqual(unread(), ["a"]);

  await actions.readThrough({ ...open, unread: true }, 4);
  assert.equal(tool.mock.calls.length, 1);

  actions.release("a");
  await actions.readThrough({ ...open, unread: true }, 4);

  assert.deepEqual(tool.mock.calls.at(-1), [
    "app_set_task_read",
    { task_id: "a", read: true, through: 4 },
  ]);
});

test("marking shows at once and returns to what the task was when it fails", async () => {
  const open = task({ id: "a", unread: true });
  const { actions, tool, unread } = setup([open]);
  let fail!: (error: Error) => void;

  tool.mockReturnValueOnce(
    new Promise((_resolve, reject) => {
      fail = reject;
    }),
  );

  const marking = actions.markRead(open);
  assert.deepEqual(unread(), []);

  fail(new Error("offline"));
  await assert.rejects(marking, /offline/);
  assert.deepEqual(unread(), ["a"]);
});

test("marking the open task read removes its New divider, and restores it if the service fails", async () => {
  const open = task({ id: "a", unread: true, read_through: 2 });
  const { actions, tool, snapshot } = setup([open, task({ id: "b" })], "a");

  await actions.markUnreadFrom(open, 5);
  const mark = snapshot().newMark;

  // Another task leaves the open task's divider alone.
  await actions.markRead(task({ id: "b", unread: true }));
  assert.equal(snapshot().newMark, mark);

  tool.mockRejectedValueOnce(new Error("offline"));
  await assert.rejects(actions.markRead(open), /offline/);
  assert.equal(snapshot().newMark, mark);

  await actions.markRead(open);

  assert.deepEqual(snapshot().newMark, {
    task: "a",
    through: undefined,
    revision: 2,
  });

  await actions.markUnreadFrom(open, 5);
  await actions.markAllRead([task({ id: "a", unread: true })]);

  assert.deepEqual(snapshot().newMark, {
    task: "a",
    through: undefined,
    revision: 4,
  });
});

test("Mark all read sends only the unread tasks", async () => {
  const tasks = [
    task({ id: "a", unread: true }),
    task({ id: "b" }),
    task({ id: "c", unread: true }),
  ];

  const { actions, tool, unread } = setup(tasks);
  await actions.markAllRead(tasks);

  assert.deepEqual(tool.mock.calls, [
    ["app_mark_tasks_read", { task_ids: ["a", "c"] }],
  ]);

  assert.deepEqual(unread(), []);
});

test("a failed read mark stays quiet and is sent again on the next reading", async () => {
  const open = task({ id: "a", unread: true });
  const { actions, tool, unread } = setup([open]);
  tool.mockRejectedValueOnce(new Error("offline"));

  await actions.readThrough(open, 4);
  assert.deepEqual(unread(), ["a"]);

  await actions.readThrough(open, 4);
  assert.equal(tool.mock.calls.length, 2);
  assert.deepEqual(unread(), []);
});

test("the list takes the service's marker, so a task reopened later divides at the right place", async () => {
  const open = task({ id: "a", unread: true, read_through: 2 });
  const { actions, tool, snapshot } = setup([open], "a");

  await actions.readThrough(open, 9);
  assert.deepEqual(snapshot().tasks[0], task({ id: "a" }));

  tool.mockResolvedValueOnce({ unread: true, through: 9 } as never);
  await actions.markUnread(task({ id: "a" }));

  assert.deepEqual(
    snapshot().tasks[0],
    task({ id: "a", unread: true, read_through: 9 }),
  );
});

test("marking unread from a message moves the divider at once, and back if the service fails", async () => {
  const open = task({ id: "a", unread: true, read_through: 2 });
  const { actions, tool, snapshot } = setup([open], "a");
  let fail!: (error: Error) => void;

  tool.mockReturnValueOnce(
    new Promise((_resolve, reject) => {
      fail = reject;
    }),
  );

  const marking = actions.markUnreadFrom(open, 5);
  assert.deepEqual(snapshot().newMark, { task: "a", through: 4, revision: 1 });

  fail(new Error("offline"));
  await assert.rejects(marking, /offline/);
  assert.equal(snapshot().newMark, undefined);

  // The failed mark no longer holds the task, so reading it marks it read again.
  await actions.readThrough(open, 6);

  assert.deepEqual(tool.mock.calls.at(-1), [
    "app_set_task_read",
    { task_id: "a", read: true, through: 6 },
  ]);
});

test("undoing mark read puts the task back unread from its read point, with the open task's divider", async () => {
  const open = task({
    id: "a",
    title: "Parser",
    unread: true,
    read_through: 4,
  });

  const { actions, tool, entries, snapshot } = setup([open], "a");

  await actions.markRead(open);
  const [entry] = entries;

  expect(entry!.label).toBe("Marked “Parser” read");
  tool.mockResolvedValueOnce({ unread: true, through: 4 } as never);
  await entry!.undo();

  expect(tool).toHaveBeenLastCalledWith("app_mark_task_unread_from", {
    task_id: "a",
    event_id: 5,
  });

  expect(snapshot().newMark).toMatchObject({ task: "a", through: 4 });
  // Reading the open task doesn't mark it read again at once.
  await actions.readThrough(snapshot().tasks[0]!, 9);
  expect(tool).toHaveBeenCalledTimes(2);
});

test("undoing mark unread on a task without newer replies marks it read again, and mark all read undoes each task", async () => {
  const quiet = task({ id: "q", title: "Quiet" });
  const a = task({ id: "a", unread: true, read_through: 2 });
  const b = task({ id: "b", unread: true, read_through: 7 });
  const { actions, tool, entries } = setup([quiet, a, b]);

  await actions.markUnread(quiet);
  await actions.markAllRead([a, b]);

  const [unmark, all] = entries as [UndoEntry, UndoEntry];

  expect(all).toMatchObject({ label: "Marked 2 tasks read", toast: true });
  tool.mockClear();
  // The service reports them unread again from each read point.
  tool.mockResolvedValue({ unread: true, through: 0 } as never);
  await all.undo();

  expect(tool.mock.calls.map(([, args]) => args.event_id)).toEqual(
    expect.arrayContaining([3, 8]),
  );

  tool.mockClear();
  tool.mockResolvedValue({ unread: false, through: 9 } as never);
  await unmark.undo();

  expect(tool.mock.calls).toEqual([
    ["app_set_task_read", { task_id: "q", read: true }],
  ]);
});
