import { test } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/core/store.js";
import { startSchema, type Task } from "../src/core/model.js";

test("recent events return only the task's latest 200 in chronological order after owner checks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "task-recent-events-"));
  const store = new Store(join(dir, "tasks.sqlite"));

  const task: Task = {
    ...startSchema.parse({
      title: "Review",
      description: "Review",
      worker_profile: "reviewer",
    }),
    title: "Review",
    id: "recent",
    owner: "alice",
    status: "running",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    instructions: [],
    attempt: 1,
    runtime_ms: 0,
  };

  try {
    store.save(task);
    const other = { ...task, id: "other" };
    store.save(other);
    assert.deepEqual(store.recentEvents(task.id, task.owner), []);
    const expected = [];

    for (let index = 0; index < 205; index++) {
      expected.push(store.event(task, "agent.message", { index }));
      store.event(other, "agent.message", { unrelated: index });
    }

    assert.deepEqual(
      store.recentEvents(task.id, task.owner),
      expected.slice(-200),
    );

    assert.throws(() => store.recentEvents(task.id, "bob"), /Task not found/);

    assert.throws(
      () => store.recentEvents("missing", task.owner),
      /Task not found/,
    );
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("stored requests regain titles without losing descriptions, timestamps, or events", async () => {
  const dir = await mkdtemp(join(tmpdir(), "task-title-migration-"));
  const path = join(dir, "tasks.sqlite");
  const original = new Store(path);

  const request =
    "Review authentication.\nInclude every edge case and report the evidence.";

  const base = {
    owner: "alice",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
    status: "completed",
  };

  const records = [
    { ...base, id: "missing", description: request },
    { ...base, id: "blank", title: " \n\t ", description: request },
    { ...base, id: "legacy-task", task: request },
    { ...base, id: "legacy-title", title: request },
    { ...base, id: "current", title: "Existing summary", description: request },
    {
      ...base,
      id: "both",
      title: "Existing summary",
      description: request,
      task: "Obsolete instructions",
    },
  ];

  const insert = original.db.prepare("INSERT INTO tasks VALUES(?,?,?)");

  for (const record of records) {
    insert.run(record.id, record.owner, JSON.stringify(record));
  }

  original.db
    .prepare("INSERT INTO events(task_id,type,timestamp,data) VALUES(?,?,?,?)")
    .run(
      "legacy-task",
      "task.completed",
      base.updated_at,
      '{"result":"preserved"}',
    );

  original.close();
  let migrated: Store | undefined;

  try {
    migrated = new Store(path);

    for (const record of records) {
      const task = migrated.get(record.id, "alice");
      assert.equal(task.description, request);

      assert.equal(
        task.title,
        ["current", "both"].includes(record.id)
          ? "Existing summary"
          : "Review authentication.",
      );

      assert.equal(task.created_at, base.created_at);
      assert.equal(task.updated_at, base.updated_at);
      assert.ok(!("task" in task));
    }

    assert.throws(() => migrated!.get("legacy-task", "bob"), /Task not found/);
    const events = migrated.events("legacy-task", "alice");
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "task.completed");
    assert.deepEqual(events[0].data, { result: "preserved" });

    const stored = migrated.db
      .prepare("SELECT id,owner,body FROM tasks ORDER BY id")
      .all();

    migrated.close();
    migrated = new Store(path);

    assert.deepEqual(
      migrated.db.prepare("SELECT id,owner,body FROM tasks ORDER BY id").all(),
      stored,
    );

    assert.deepEqual(migrated.events("legacy-task", "alice"), events);
  } finally {
    migrated?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
