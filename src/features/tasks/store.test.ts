import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test } from "vitest";

import { startSchema, type Task } from "../../shared/contracts.js";
import { Store } from "./store.js";

function deletionFixture() {
  const store = new Store(":memory:");

  const task: Task = {
    ...startSchema.parse({ title: "Delete", description: "Delete" }),
    title: "Delete",
    id: "delete",
    owner: "alice",
    status: "completed",
    created_at: "now",
    updated_at: "now",
    instructions: [],
    attempt: 1,
    runtime_ms: 0,
  };

  store.db.exec(`
    CREATE TABLE codex_executors(task_id TEXT PRIMARY KEY REFERENCES tasks(id), owner TEXT NOT NULL, body TEXT NOT NULL);
    CREATE TABLE form_requests(id TEXT PRIMARY KEY, owner TEXT NOT NULL, expires INTEGER NOT NULL, body TEXT NOT NULL);
    CREATE TABLE event_outbox(subscription_id TEXT NOT NULL,event_id TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'ready',attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(subscription_id,event_id));
  `);

  for (const id of [task.id, `${task.id}_1`, "unrelated"]) {
    const current = { ...task, id };
    store.save(current);
    store.event(current, "task.completed", {});

    store.db
      .prepare("INSERT INTO codex_executors VALUES(?,?,?)")
      .run(id, task.owner, "{}");

    store.db
      .prepare("INSERT INTO form_requests VALUES(?,?,?,?)")
      .run(id, task.owner, 0, JSON.stringify({ task_id: id }));

    for (const subscription of ["first", "second"])
      store.db
        .prepare(
          "INSERT INTO event_outbox(subscription_id,event_id,body) VALUES(?,?,?)",
        )
        .run(subscription, `evt_${id}_42`, "{}");
  }

  const snapshot = () =>
    Object.fromEntries(
      [
        "tasks",
        "events",
        "codex_executors",
        "form_requests",
        "event_outbox",
      ].map((table) => [
        table,
        store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
      ]),
    );

  return { store, task, snapshot };
}

test("task deletion removes auxiliary records and preserves other tasks, including matching prefixes", (t) => {
  const { store, task, snapshot } = deletionFixture();
  t.onTestFinished(() => store.close());
  const before = snapshot();
  assert.throws(() => store.delete(task.id, "bob"), /Task not found/);
  assert.deepEqual(snapshot(), before);

  store.delete(task.id, task.owner);
  assert.throws(() => store.get(task.id, task.owner), /Task not found/);
  const after = snapshot();
  for (const table of ["tasks", "events", "codex_executors", "form_requests"])
    assert.equal(after[table].length, 2, table);

  assert.deepEqual(
    after.event_outbox,
    before.event_outbox.filter((row) => row.event_id !== `evt_${task.id}_42`),
  );

  assert.equal(store.get(`${task.id}_1`, task.owner).id, `${task.id}_1`);
  assert.equal(store.events(`${task.id}_1`, task.owner).length, 1);
});

test("task deletion rolls back auxiliary cleanup if deleting the task fails", (t) => {
  const { store, task, snapshot } = deletionFixture();
  t.onTestFinished(() => store.close());
  const before = snapshot();

  store.db.exec(
    "CREATE TRIGGER reject_task_delete BEFORE DELETE ON tasks BEGIN SELECT RAISE(ABORT, 'delete failed'); END",
  );

  assert.throws(() => store.delete(task.id, task.owner), /delete failed/);
  assert.deepEqual(snapshot(), before);
  store.db.exec("DROP TRIGGER reject_task_delete");
  store.delete(task.id, task.owner);
  assert.throws(() => store.get(task.id, task.owner), /Task not found/);
});

test("task deletion works before optional auxiliary tables are initialized", (t) => {
  const store = new Store(":memory:");
  t.onTestFinished(() => store.close());

  store.db
    .prepare("INSERT INTO tasks VALUES(?,?,?)")
    .run("plain", "alice", JSON.stringify({ id: "plain", owner: "alice" }));

  store.delete("plain", "alice");
  assert.deepEqual(store.all(), []);
});

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

test("opening a store drops stored artifacts and their events, and repeats safely", async () => {
  const dir = await mkdtemp(join(tmpdir(), "task-artifact-migration-"));
  const path = join(dir, "tasks.sqlite");
  const original = new Store(path);

  const task: Task = {
    ...startSchema.parse({
      title: "Review",
      description: "Review",
      worker_profile: "reviewer",
    }),
    title: "Review",
    id: "with-artifacts",
    owner: "alice",
    status: "completed",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    instructions: [],
    attempt: 1,
    runtime_ms: 0,
  };

  try {
    original.save(task);
    const kept = original.event(task, "agent.message", { text: "Done" });
    original.event(task, "artifact.created", { artifact_id: "art_1" });
    original.event(task, "artifact.error", { message: "No diff" });

    // The table as older versions created it.
    original.db
      .exec(`CREATE TABLE artifacts(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks(id),body TEXT NOT NULL,summary TEXT);
    INSERT INTO artifacts(id,task_id,body) VALUES('art_1','with-artifacts','{}');`);

    original.close();

    for (let open = 0; open < 2; open++) {
      const store = new Store(path);

      try {
        assert.deepEqual(store.events(task.id, task.owner), [kept]);

        assert.equal(
          store.db
            .prepare(
              "SELECT name FROM sqlite_master WHERE type='table' AND name='artifacts'",
            )
            .get(),
          undefined,
        );
      } finally {
        store.close();
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
