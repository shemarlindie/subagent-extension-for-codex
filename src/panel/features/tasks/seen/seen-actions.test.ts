import assert from "node:assert/strict";

import { test, vi } from "vitest";

import { task as taskFixture } from "../../../app/state/controller-test-harness";
import type { Snapshot, Task } from "../../../app/state/types";
import { SeenActions } from "./seen-actions";

const task = ({ id, ...patch }: Partial<Task> & { id: string }): Task => ({
  ...taskFixture(id),
  ...patch,
});

function setup(tasks: Task[], selected?: string) {
  let snapshot = { tasks, selected } as Snapshot;

  const tool = vi.fn(
    async (_name: string, _args: Record<string, unknown>) =>
      ({ unseen: false, through: 9 }) as never,
  );

  const seen = new SeenActions({
    snapshot: () => snapshot,
    closed: () => false,
    patch: (patch) => {
      snapshot = { ...snapshot, ...patch };
    },
    tool,
    report: () => {},
  });

  const unseen = () =>
    snapshot.tasks.filter((task) => task.unseen).map((task) => task.id);

  return { seen, tool, unseen, snapshot: () => snapshot };
}

test("reading sends each Chat cursor once, and only for an unseen task", async () => {
  const open = task({ id: "a", unseen: true });
  const { seen, tool, unseen } = setup([open]);

  await seen.read(open, 4);
  await seen.read(open, 4);
  await seen.read(task({ id: "a" }), 5);

  assert.deepEqual(tool.mock.calls, [
    ["mark_user_agent_task_seen", { task_id: "a", seen: true, through: 4 }],
  ]);

  assert.deepEqual(unseen(), []);
});

test("an open task marked unseen stays unseen while read, until the reader leaves its end", async () => {
  const open = task({ id: "a" });
  const { seen, tool, unseen } = setup([open], "a");

  tool.mockResolvedValueOnce({ unseen: true, through: 9 } as never);
  await seen.markUnseen(open);
  assert.deepEqual(unseen(), ["a"]);

  await seen.read({ ...open, unseen: true }, 4);
  assert.equal(tool.mock.calls.length, 1);

  seen.release("a");
  await seen.read({ ...open, unseen: true }, 4);

  assert.deepEqual(tool.mock.calls.at(-1), [
    "mark_user_agent_task_seen",
    { task_id: "a", seen: true, through: 4 },
  ]);
});

test("marking shows at once and returns to what the task was when it fails", async () => {
  const open = task({ id: "a", unseen: true });
  const { seen, tool, unseen } = setup([open]);
  let fail!: (error: Error) => void;

  tool.mockReturnValueOnce(
    new Promise((_resolve, reject) => {
      fail = reject;
    }),
  );

  const marking = seen.markSeen(open);
  assert.deepEqual(unseen(), []);

  fail(new Error("offline"));
  await assert.rejects(marking, /offline/);
  assert.deepEqual(unseen(), ["a"]);
});

test("Mark all seen sends only the unseen tasks", async () => {
  const tasks = [
    task({ id: "a", unseen: true }),
    task({ id: "b" }),
    task({ id: "c", unseen: true }),
  ];

  const { seen, tool, unseen } = setup(tasks);
  await seen.markAllSeen(tasks);

  assert.deepEqual(tool.mock.calls, [
    ["mark_user_agent_tasks_seen", { task_ids: ["a", "c"] }],
  ]);

  assert.deepEqual(unseen(), []);
});

test("a failed read stays quiet and is sent again on the next read", async () => {
  const open = task({ id: "a", unseen: true });
  const { seen, tool, unseen } = setup([open]);
  tool.mockRejectedValueOnce(new Error("offline"));

  await seen.read(open, 4);
  assert.deepEqual(unseen(), ["a"]);

  await seen.read(open, 4);
  assert.equal(tool.mock.calls.length, 2);
  assert.deepEqual(unseen(), []);
});

test("the list takes the service's marker, so a task reopened later divides at the right place", async () => {
  const open = task({ id: "a", unseen: true, seen_through: 2 });
  const { seen, tool, snapshot } = setup([open], "a");

  await seen.read(open, 9);
  assert.deepEqual(snapshot().tasks[0], task({ id: "a" }));

  tool.mockResolvedValueOnce({ unseen: true, through: 9 } as never);
  await seen.markUnseen(task({ id: "a" }));

  assert.deepEqual(
    snapshot().tasks[0],
    task({ id: "a", unseen: true, seen_through: 9 }),
  );
});
