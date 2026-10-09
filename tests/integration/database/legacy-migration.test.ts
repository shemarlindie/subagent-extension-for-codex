import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { test, type TestContext } from "vitest";

import { migrateLegacyDatabase } from "../../../dev/migrate-legacy-database.js";
import { Settings } from "../../../src/features/settings/settings.js";
import { Store } from "../../../src/features/tasks/store.js";
import { openDatabase } from "../../../src/platform/database/database.js";
import { startSchema, type Task } from "../../../src/shared/contracts.js";

// The schema every feature created in its constructor before versioned
// migrations (commit c40cb73).
const LEGACY_SCHEMA = `
  CREATE TABLE tasks(id TEXT PRIMARY KEY, owner TEXT NOT NULL, body TEXT NOT NULL);
  CREATE TABLE events(id INTEGER PRIMARY KEY AUTOINCREMENT,task_id TEXT NOT NULL REFERENCES tasks(id),type TEXT NOT NULL,timestamp TEXT NOT NULL,data TEXT NOT NULL);
  CREATE INDEX events_task ON events(task_id,id);
  CREATE TABLE project_roots(path TEXT PRIMARY KEY, kind TEXT NOT NULL);
  CREATE TABLE user_settings(owner TEXT PRIMARY KEY, body TEXT NOT NULL);
  CREATE TABLE form_requests(id TEXT PRIMARY KEY, owner TEXT NOT NULL, expires INTEGER NOT NULL, body TEXT NOT NULL);
  CREATE TABLE event_subscriptions(id TEXT PRIMARY KEY,owner TEXT NOT NULL,body TEXT NOT NULL);
  CREATE TABLE event_outbox(subscription_id TEXT NOT NULL,event_id TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'ready',attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(subscription_id,event_id));
  CREATE TABLE event_checkpoint(id INTEGER PRIMARY KEY CHECK(id=1),cursor INTEGER NOT NULL);
  INSERT INTO event_checkpoint VALUES(1,0);
  CREATE TABLE artifacts(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks(id),body TEXT NOT NULL,summary TEXT);
`;

const task = (id: string): Task => ({
  ...startSchema.parse({ description: "Migrate" }),
  title: "Migrate",
  id,
  owner: "alice",
  status: "completed",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  instructions: [],
  created_by: "user",
  instructions_sent: 0,
  pending_steers: [],
  queue: [],
  turn: 1,
  runtime_ms: 0,
});

const form = (taskId?: string) =>
  JSON.stringify({
    kind: taskId ? "request_agent_input" : "request_agent_task",
    args: {},
    form: { type: "object", properties: {} },
    message: "Answer",
    status: "pending",
    ...(taskId ? { task_id: taskId } : {}),
  });

const envelope = (taskId: string, eventId: number) =>
  JSON.stringify({
    eventId: `evt_${taskId}_${eventId}`,
    name: "agent_task.completed",
    data: { task_id: taskId },
  });

/** A settings body as the service saves it. */
function savedSettings() {
  const store = new Store(":memory:");

  try {
    new Settings(store.database, () => ["claude"]).update("alice", {
      set: { max_runtime_minutes: 10 },
    });

    return String(
      store.database.client.prepare("SELECT body FROM user_settings").get()!
        .body,
    );
  } finally {
    store.close();
  }
}

/** A data directory holding an old-schema database with representative rows. */
function legacyDataDirectory(t: TestContext) {
  const data = mkdtempSync(join(tmpdir(), "legacy-migration-"));
  t.onTestFinished(() => rmSync(data, { recursive: true, force: true }));
  const db = new DatabaseSync(join(data, "console.sqlite"));
  db.exec("PRAGMA journal_mode=WAL");
  db.exec(LEGACY_SCHEMA);

  const run = (sql: string, ...values: (string | number)[]) =>
    db.prepare(sql).run(...values);

  // A task id that prefixes another's, as the old outbox ids made ambiguous.
  for (const id of ["task_a", "task_a_1"])
    run(
      "INSERT INTO tasks VALUES(?,?,?)",
      id,
      "alice",
      JSON.stringify(task(id)),
    );

  run("INSERT INTO events VALUES(5,'task_a','task.completed','now','{}')");

  run(
    "INSERT INTO events VALUES(9,'task_a_1','agent.reply','now','{\"text\":\"hi\"}')",
  );

  // The newest event was deleted, so the sequence is ahead of the kept ids.
  run("INSERT INTO events VALUES(12,'task_a','task.started','now','{}')");
  run("DELETE FROM events WHERE id=12");

  run("INSERT INTO artifacts VALUES('art','task_a','{}',NULL)");
  run("UPDATE event_checkpoint SET cursor=9");
  run("INSERT INTO project_roots VALUES('/repo','repository')");

  run("INSERT INTO user_settings VALUES(?,?)", "alice", savedSettings());

  run(
    "INSERT INTO form_requests VALUES('input',?,?,?)",
    "alice",
    9e12,
    form("task_a_1"),
  );

  run("INSERT INTO form_requests VALUES('start',?,?,?)", "alice", 9e12, form());

  run(
    "INSERT INTO form_requests VALUES('stale',?,?,?)",
    "alice",
    9e12,
    form("gone"),
  );

  run(
    "INSERT INTO event_subscriptions VALUES(?,?,?)",
    "sub_1",
    "alice",
    JSON.stringify({
      id: "sub_1",
      owner: "alice",
      name: "agent_task.completed",
      arguments: {},
      url: "https://example.com/hook",
      secret: "sealed",
      expires: 9e12,
      after_event: 0,
      active: true,
    }),
  );

  for (const [taskId, eventId] of [
    ["task_a", 5],
    ["task_a_1", 9],
    ["gone", 3],
  ] as const)
    run(
      "INSERT INTO event_outbox(subscription_id,event_id,body,attempts) VALUES(?,?,?,2)",
      "sub_1",
      `evt_${taskId}_${eventId}`,
      envelope(taskId, eventId),
    );

  // Left open, so the last writes may still be in the WAL.
  return { data, legacy: db };
}

test("an old database migrates with its records, task references and event ids", (t) => {
  const { data, legacy } = legacyDataDirectory(t);
  legacy.close();

  const report = migrateLegacyDatabase(data);

  assert.deepEqual(report, {
    copied: {
      tasks: 2,
      events: 2,
      form_requests: 2,
      project_roots: 1,
      user_settings: 1,
      event_subscriptions: 1,
      event_outbox: 2,
    },
    dropped: { form_requests: 1, event_outbox: 1, artifacts: 1 },
  });

  assert.ok(existsSync(join(data, "console.sqlite.pre-migration")));
  assert.ok(!existsSync(join(data, "console.sqlite.migrating")));

  const store = new Store(join(data, "console.sqlite"));
  t.onTestFinished(() => store.close());
  const client = store.database.client;

  assert.deepEqual(
    store
      .all("alice")
      .map((t) => t.id)
      .sort(),
    ["task_a", "task_a_1"],
  );

  assert.deepEqual(
    store.events("task_a_1", "alice").map((e) => [e.id, e.data]),
    [[9, { text: "hi" }]],
  );

  // New events continue after the old sequence, deleted ids included.
  assert.equal(store.event(task("task_a"), "task.started").id, 13);

  assert.deepEqual(
    client
      .prepare("SELECT id, task_id FROM form_requests ORDER BY id")
      .all()
      .map((row) => ({ ...row })),
    [
      { id: "input", task_id: "task_a_1" },
      { id: "start", task_id: null },
    ],
  );

  assert.deepEqual(
    client
      .prepare(
        "SELECT event_id, task_id, attempts FROM event_outbox ORDER BY event_id",
      )
      .all()
      .map((row) => ({ ...row })),
    [
      { event_id: "evt_task_a_1_9", task_id: "task_a_1", attempts: 2 },
      { event_id: "evt_task_a_5", task_id: "task_a", attempts: 2 },
    ],
  );

  assert.equal(
    client.prepare("SELECT cursor FROM event_checkpoint").get()?.cursor,
    9,
  );

  // Deleting a task now cascades to its forms and deliveries.
  store.delete("task_a_1", "alice");

  assert.equal(
    client.prepare("SELECT COUNT(*) AS n FROM event_outbox").get()?.n,
    1,
  );

  assert.throws(() => migrateLegacyDatabase(data), /already exists/);
});

test("a dry run checks everything and leaves the old database in place", (t) => {
  const { data, legacy } = legacyDataDirectory(t);
  legacy.close();

  assert.equal(migrateLegacyDatabase(data, { dryRun: true }).copied.tasks, 2);
  assert.ok(!existsSync(join(data, "console.sqlite.pre-migration")));
  assert.ok(!existsSync(join(data, "console.sqlite.migrating")));

  const after = new DatabaseSync(join(data, "console.sqlite"));
  t.onTestFinished(() => after.close());
  assert.equal(after.prepare("SELECT COUNT(*) AS n FROM tasks").get()?.n, 2);
});

test("a malformed record stops the migration and leaves the old database untouched", (t) => {
  const { data, legacy } = legacyDataDirectory(t);
  legacy.prepare("UPDATE tasks SET body='{}' WHERE id='task_a'").run();
  legacy.close();

  assert.throws(
    () => migrateLegacyDatabase(data),
    /Stored task task_a is malformed/,
  );

  assert.ok(!existsSync(join(data, "console.sqlite.pre-migration")));
  assert.ok(!existsSync(join(data, "console.sqlite.migrating")));
  assert.ok(!existsSync(join(data, "service.pid")));
});

test("a running service or an already versioned database is refused", (t) => {
  const { data, legacy } = legacyDataDirectory(t);
  legacy.close();

  writeFileSync(join(data, "service.pid"), String(process.ppid));

  assert.throws(
    () => migrateLegacyDatabase(data),
    /live service already owns this data directory/,
  );

  rmSync(join(data, "service.pid"));

  const current = mkdtempSync(join(tmpdir(), "legacy-migration-current-"));
  t.onTestFinished(() => rmSync(current, { recursive: true, force: true }));
  openDatabase(join(current, "console.sqlite")).close();
  assert.throws(() => migrateLegacyDatabase(current), /already versioned/);
});
