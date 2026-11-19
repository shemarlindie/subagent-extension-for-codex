import assert from "node:assert/strict";

import { test, vi } from "vitest";

import type { ArchiveResult } from "../../../../shared/tasks/archive.js";
import { task as taskFixture } from "../../../app/state/controller-test-harness";
import type { Snapshot, Task } from "../../../app/state/types";
import { undoRecorder } from "../../../app/state/undo-test-harness";
import { ArchiveActions } from "./archive-actions";

const task = ({ id, ...patch }: Partial<Task> & { id: string }): Task => ({
  ...taskFixture(id),
  status: "completed",
  ...patch,
});

function setup(
  tasks: Task[],
  answer: () => Promise<ArchiveResult>,
  selected?: string,
) {
  let snapshot = { tasks, selected } as Snapshot;
  const shown: string[][] = [];

  const archived = () =>
    snapshot.tasks.filter((task) => task.archived_at).map((task) => task.id);

  const tool = vi.fn((_name: string, _args: Record<string, unknown>) => {
    // What the list shows while the service answers.
    shown.push(archived());

    return answer() as Promise<never>;
  });

  const leaveSelection = vi.fn(() => {
    snapshot = { ...snapshot, selected: undefined };
  });

  const select = vi.fn(async (id: string) => {
    snapshot = { ...snapshot, selected: id };
  });

  const { recorder, entries } = undoRecorder();

  const actions = new ArchiveActions({
    snapshot: () => snapshot,
    closed: () => false,
    patch: (patch) => {
      snapshot = { ...snapshot, ...patch };
    },
    tool,
    leaveSelection,
    select,
    undo: recorder,
  });

  return {
    actions,
    tool,
    archived,
    shown,
    leaveSelection,
    select,
    entries,
    /** Replaces the list, as a refresh does. */
    list: (tasks: Task[]) => {
      snapshot = { ...snapshot, tasks };
    },
    listed: () => snapshot.tasks.map((task) => task.id),
  };
}

test("archiving shows at once, sends only tasks that can change and keeps what the service skipped listed", async () => {
  const tasks = [
    task({ id: "a" }),
    task({ id: "b" }),
    task({ id: "busy", status: "running" }),
    task({ id: "old", archived_at: "then" }),
  ];

  const { actions, tool, archived, shown } = setup(tasks, () =>
    Promise.resolve({ task_ids: ["a"], skipped: ["b"] }),
  );

  const result = await actions.setArchived(tasks, true);

  assert.deepEqual(tool.mock.calls, [
    ["app_set_tasks_archived", { task_ids: ["a", "b"], archived: true }],
  ]);

  assert.deepEqual(shown, [["a", "b", "old"]]);
  assert.deepEqual(archived(), ["a", "old"]);
  assert.deepEqual(result, { task_ids: ["a"], skipped: ["b"] });
});

test("a failed archive restores the list and rethrows", async () => {
  const archiving = task({ id: "a" });

  const { actions, archived } = setup([archiving], () =>
    Promise.reject(new Error("offline")),
  );

  await assert.rejects(actions.toggle(archiving), /offline/);
  assert.deepEqual(archived(), []);
});

test("archiving the open task closes it once the service archives it, while other changes keep it open", async () => {
  const open = task({ id: "open" });
  const other = task({ id: "other" });
  const old = task({ id: "old", archived_at: "then" });
  let result: ArchiveResult = { task_ids: ["other"], skipped: [] };

  const { actions, leaveSelection } = setup(
    [open, other, old],
    () => Promise.resolve(result),
    "open",
  );

  await actions.setArchived([other], true);
  result = { task_ids: ["old"], skipped: [] };
  await actions.toggle(old);
  result = { task_ids: ["other"], skipped: ["open"] };
  await actions.setArchived([open, other], true);
  assert.equal(leaveSelection.mock.calls.length, 0);

  result = { task_ids: ["open"], skipped: [] };
  await actions.toggle(open);
  assert.equal(leaveSelection.mock.calls.length, 1);
});

test("undo and redo change only the tasks the service archived", async () => {
  const done = task({ id: "done", title: "Done" });
  const skipped = task({ id: "skipped" });

  const { actions, tool, entries } = setup([done, skipped], () =>
    Promise.resolve({ task_ids: ["done"], skipped: ["skipped"] }),
  );

  await actions.setArchived([done, skipped], true);
  const [entry] = entries;
  assert.ok(entry);
  assert.equal(entry.label, "Archived “Done”");
  tool.mockResolvedValue({ task_ids: ["done"], skipped: [] } as never);
  await entry.undo();
  await entry.redo();

  assert.deepEqual(
    tool.mock.calls.slice(1).map(([, args]) => args),
    [
      { task_ids: ["done"], archived: false },
      { task_ids: ["done"], archived: true },
    ],
  );
});

test("undo lists an archived task again after a refresh dropped it, and reopens it", async () => {
  const older = task({ id: "older", created_at: "2026-01-01T00:00:00.000Z" });
  const open = task({ id: "open", created_at: "2026-01-02T00:00:00.000Z" });
  const newer = task({ id: "newer", created_at: "2026-01-03T00:00:00.000Z" });

  const { actions, entries, archived, select, list, listed } = setup(
    [newer, open, older],
    () => Promise.resolve({ task_ids: ["open"], skipped: [] }),
    "open",
  );

  await actions.toggle(open);
  // The list leaves archived tasks out.
  list([newer, older]);
  const [entry] = entries;
  assert.ok(entry);
  await entry.undo();

  assert.deepEqual(listed(), ["newer", "open", "older"]);
  assert.deepEqual(archived(), []);
  assert.deepEqual(select.mock.calls, [["open"]]);
});

test("an archive the service skips entirely leaves nothing to undo", async () => {
  const { actions, entries } = setup([task({ id: "a" })], () =>
    Promise.resolve({ task_ids: [], skipped: ["a"] }),
  );

  await actions.setArchived([task({ id: "a" })], true);
  assert.equal(entries.length, 0);
});

test("archiving more than a request can hold preserves the successful batch when another fails", async () => {
  const tasks = Array.from({ length: 1001 }, (_, index) =>
    task({ id: String(index) }),
  );

  const ids = tasks.slice(0, 1000).map((task) => task.id);
  const error = new Error("offline");

  const { actions, tool, archived, entries } = setup(tasks, () =>
    Promise.reject(error),
  );

  tool.mockResolvedValueOnce({ task_ids: ids, skipped: [] } as never);

  assert.deepEqual(await actions.setArchived(tasks, true), {
    task_ids: ids,
    skipped: [],
    failure: { count: 1, error },
  });

  assert.deepEqual(archived(), ids);
  const [entry] = entries;
  assert.ok(entry);
  tool.mockResolvedValueOnce({ task_ids: ids, skipped: [] } as never);
  await entry.undo();
  assert.deepEqual(archived(), []);

  assert.deepEqual(
    tool.mock.calls.map(([, args]) => [
      args.archived,
      (args.task_ids as string[]).length,
    ]),
    [
      [true, 1000],
      [true, 1],
      [false, 1000],
    ],
  );
});

test("archiving reads the tasks when its turn comes, leaving one an earlier change archived", async () => {
  const done = task({ id: "done" });

  const { actions, tool, list } = setup([done], () =>
    Promise.resolve({ task_ids: ["done"], skipped: [] }),
  );

  list([{ ...done, archived_at: "now" }]);
  await actions.setArchived([done], true);

  assert.equal(tool.mock.calls.length, 0);
});
