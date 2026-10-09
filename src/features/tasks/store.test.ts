import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test, vi } from "vitest";

import { type Event, startSchema, type Task } from "../../shared/contracts.js";
import { Store } from "./store.js";

function deletionFixture() {
  const store = new Store(":memory:");

  const task: Task = {
    ...startSchema.parse({ description: "Delete" }),
    title: "Delete",
    id: "delete",
    owner: "alice",
    status: "completed",
    created_at: "now",
    updated_at: "now",
    instructions: [],
    created_by: "user",
    instructions_sent: 0,
    pending_steers: [],
    queue: [],
    turn: 1,
    runtime_ms: 0,
  };

  for (const id of [task.id, `${task.id}_1`, "unrelated"]) {
    const current = { ...task, id };
    store.save(current);
    store.event(current, "task.completed", {});

    store.database.client
      .prepare(
        "INSERT INTO form_requests(id,owner,expires,task_id,body) VALUES(?,?,?,?,?)",
      )
      .run(id, task.owner, 0, id, JSON.stringify({ task_id: id }));

    for (const subscription of ["first", "second"])
      store.database.client
        .prepare(
          "INSERT INTO event_outbox(subscription_id,event_id,task_id,body) VALUES(?,?,?,?)",
        )
        .run(subscription, `evt_${id}_42`, id, "{}");
  }

  // Forms that register a project or start a task belong to no task.
  store.database.client
    .prepare(
      "INSERT INTO form_requests(id,owner,expires,task_id,body) VALUES(?,?,?,?,?)",
    )
    .run("taskless", task.owner, 0, null, "{}");

  const snapshot = () =>
    Object.fromEntries(
      ["tasks", "events", "form_requests", "event_outbox"].map((table) => [
        table,
        store.database.client
          .prepare(`SELECT * FROM ${table} ORDER BY rowid`)
          .all(),
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
  for (const table of ["tasks", "events"])
    assert.equal(after[table].length, 2, table);

  assert.deepEqual(
    after.form_requests.map((row) => row.id),
    [`${task.id}_1`, "unrelated", "taskless"],
  );

  assert.deepEqual(
    after.event_outbox,
    before.event_outbox.filter((row) => row.event_id !== `evt_${task.id}_42`),
  );

  assert.equal(store.get(`${task.id}_1`, task.owner).id, `${task.id}_1`);
  assert.equal(store.events(`${task.id}_1`, task.owner).length, 1);
});

test("task deletion leaves every record in place if deleting the task fails", (t) => {
  const { store, task, snapshot } = deletionFixture();
  t.onTestFinished(() => store.close());
  const before = snapshot();

  store.database.client.exec(
    "CREATE TRIGGER reject_task_delete BEFORE DELETE ON tasks BEGIN SELECT RAISE(ABORT, 'delete failed'); END",
  );

  assert.throws(() => store.delete(task.id, task.owner), /delete failed/);
  assert.deepEqual(snapshot(), before);
  store.database.client.exec("DROP TRIGGER reject_task_delete");
  store.delete(task.id, task.owner);
  assert.throws(() => store.get(task.id, task.owner), /Task not found/);
});

test("recent events return only the task's latest 200 in chronological order after owner checks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "task-recent-events-"));
  const store = new Store(join(dir, "tasks.sqlite"));

  const task: Task = {
    ...startSchema.parse({
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
    created_by: "user",
    instructions_sent: 0,
    pending_steers: [],
    queue: [],
    turn: 1,
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

function transactionFixture(t: { onTestFinished(fn: () => void): void }) {
  const store = new Store(":memory:");
  t.onTestFinished(() => store.close());

  const task: Task = {
    ...startSchema.parse({ description: "Transact" }),
    title: "Transact",
    id: "transact",
    owner: "alice",
    status: "queued",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    instructions: [],
    created_by: "user",
    instructions_sent: 0,
    pending_steers: [],
    queue: [],
    turn: 0,
    runtime_ms: 0,
  };

  store.save(task);
  const heard: string[] = [];
  store.bus.on("event", (e: Event) => heard.push(e.type));

  return { store, task, heard };
}

test("a transaction commits task state with its events and notifies in order afterwards", (t) => {
  const { store, task, heard } = transactionFixture(t);

  store.transaction(() => {
    task.status = "running";
    store.save(task);
    store.event(task, "task.started");
    store.event(task, "task.queue_changed");
    // Listeners hear nothing until the commit.
    assert.deepEqual(heard, []);
  });

  assert.deepEqual(heard, ["task.started", "task.queue_changed"]);
  assert.equal(store.get(task.id, task.owner).status, "running");

  assert.deepEqual(
    store.events(task.id, task.owner).map((e) => e.type),
    ["task.started", "task.queue_changed"],
  );
});

test("a failed transaction leaves state and events unwritten, notifies nobody and restores updated_at", (t) => {
  const { store, task, heard } = transactionFixture(t);
  const updated = task.updated_at;

  assert.throws(
    () =>
      store.transaction(() => {
        task.status = "running";
        store.save(task);
        store.event(task, "task.started");
        throw new Error("write failed");
      }),
    /write failed/,
  );

  assert.equal(task.updated_at, updated);
  assert.equal(store.get(task.id, task.owner).status, "queued");
  assert.deepEqual(store.events(task.id, task.owner), []);
  assert.deepEqual(heard, []);
});

test("transactions reject nesting and asynchronous callbacks", (t) => {
  const { store, task, heard } = transactionFixture(t);

  assert.throws(
    () =>
      store.transaction(() => {
        store.event(task, "task.started");
        store.transaction(() => {});
      }),
    /already open/,
  );

  assert.throws(
    () =>
      store.transaction(async () => {
        store.event(task, "task.started");
      }),
    /must be synchronous/,
  );

  assert.deepEqual(store.events(task.id, task.owner), []);
  assert.deepEqual(heard, []);

  // The store is usable again after both.
  store.transaction(() => store.event(task, "task.started"));
  assert.deepEqual(heard, ["task.started"]);
});

test("a failing listener neither undoes the commit nor stops other listeners", (t) => {
  const { store, task, heard } = transactionFixture(t);
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});

  store.bus.prependListener("event", () => {
    throw new Error("listener failed");
  });

  store.transaction(() => {
    store.save(task);
    store.event(task, "task.started");
  });

  store.event(task, "task.completed");
  assert.deepEqual(heard, ["task.started", "task.completed"]);
  assert.equal(store.events(task.id, task.owner).length, 2);
  assert.equal(errors.mock.calls.length, 2);
});
