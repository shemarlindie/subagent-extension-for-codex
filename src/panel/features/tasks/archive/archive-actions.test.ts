import assert from "node:assert/strict";

import { test, vi } from "vitest";

import type { ArchiveResult } from "../../../../shared/tasks/archive.js";
import { task as taskFixture } from "../../../app/state/controller-test-harness";
import type { Snapshot, Task } from "../../../app/state/types";
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

  const actions = new ArchiveActions({
    snapshot: () => snapshot,
    closed: () => false,
    patch: (patch) => {
      snapshot = { ...snapshot, ...patch };
    },
    tool,
    leaveSelection,
  });

  return { actions, tool, archived, shown, leaveSelection };
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
  const tasks = [task({ id: "a" })];

  const { actions, archived } = setup(tasks, () =>
    Promise.reject(new Error("offline")),
  );

  await assert.rejects(actions.toggle(tasks[0]!), /offline/);
  assert.deepEqual(archived(), []);
});

test("toggling unarchives an archived task, and nothing to change sends nothing", async () => {
  const old = task({ id: "old", archived_at: "then" });

  const { actions, tool, archived } = setup([old], () =>
    Promise.resolve({ task_ids: ["old"], skipped: [] }),
  );

  await actions.toggle(old);
  assert.deepEqual(archived(), []);

  await actions.setArchived([task({ id: "busy", status: "running" })], true);
  assert.equal(tool.mock.calls.length, 1);
});

test("archiving the open task closes it, while other changes keep it open", async () => {
  const open = task({ id: "open" });
  const other = task({ id: "other" });
  const old = task({ id: "old", archived_at: "then" });

  const { actions, leaveSelection } = setup(
    [open, other, old],
    () => Promise.resolve({ task_ids: [], skipped: [] }),
    "open",
  );

  await actions.setArchived([other], true);
  await actions.toggle(old);
  assert.equal(leaveSelection.mock.calls.length, 0);

  await actions.setArchived([open, other], true);
  assert.equal(leaveSelection.mock.calls.length, 1);
});
