import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test } from "vitest";

import { startSchema, type Task } from "../../../../shared/tasks/model.js";
import {
  migrationsFolder,
  openDatabase,
} from "../../../platform/database/database.js";
import { Store } from "./store.js";

function fixture(t: { onTestFinished(fn: () => void): void }) {
  const store = new Store(":memory:");
  t.onTestFinished(() => store.close());

  const task: Task = {
    ...startSchema.parse({ repository: "/repo", description: "Review" }),
    title: "Review",
    id: "seen",
    owner: "alice",
    status: "running",
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

  store.save(task);

  return { store, task };
}

test("a task is unseen once it has a reply, outcome or request after what the user saw", (t) => {
  const { store, task } = fixture(t);

  // The user's own messages leave it seen.
  store.event(task, "task.started", {});

  store.event(task, "task.instruction", {
    message: "More",
    message_id: "msg_more",
    from: "user",
    delivery: "queue",
  });

  assert.equal(store.seen(task.id).unseen, false);

  const reply = store.event(task, "agent.reply", { text: "Done", turn: 1 });
  assert.equal(store.seen(task.id).unseen, true);

  store.markSeen(task, reply.id);
  assert.equal(store.seen(task.id).unseen, false);

  for (const type of [
    "agent.message",
    "task.turn_ended",
    "task.failed",
    "agent.input_required",
  ]) {
    const event = store.eventOpaque(task, type);
    assert.equal(store.seen(task.id).unseen, true, type);
    store.markSeen(task, event.id);
    assert.equal(store.seen(task.id).unseen, false, type);
  }
});

test("seeing an earlier event never undoes a later one, nor sees events still to come", (t) => {
  const { store, task } = fixture(t);
  const first = store.event(task, "agent.reply", { text: "One", turn: 1 });
  const second = store.event(task, "agent.reply", { text: "Two", turn: 1 });

  store.markSeen(task, first.id);
  assert.equal(store.seen(task.id).unseen, true);

  store.markSeen(task, second.id);
  store.markSeen(task, first.id);
  assert.equal(store.seen(task.id).unseen, false);

  // A cursor past the newest event sees only what exists now.
  store.markSeen(task, second.id + 100);
  store.event(task, "agent.reply", { text: "Three", turn: 1 });
  assert.equal(store.seen(task.id).unseen, true);

  // Without a cursor, everything so far is seen.
  store.markSeen(task);
  assert.equal(store.seen(task.id).unseen, false);
});

test("marking a task unseen holds until the user sees it again", (t) => {
  const { store, task } = fixture(t);
  assert.equal(store.seen(task.id).unseen, false);

  store.markUnseen(task);
  assert.equal(store.seen(task.id).unseen, true);

  store.markSeen(task);
  assert.equal(store.seen(task.id).unseen, false);
});

test("marking seen or unseen announces a change without touching the task", (t) => {
  const { store, task } = fixture(t);
  const before = store.get(task.id, "alice");
  const revision = store.revision("alice");

  store.markUnseen(task);
  const unseen = store.revision("alice");
  assert.notEqual(unseen, revision);

  store.markSeen(task);
  assert.notEqual(store.revision("alice"), unseen);
  assert.deepEqual(store.get(task.id, "alice"), before);
});

test("deleting a task deletes what the user saw of it", (t) => {
  const { store, task } = fixture(t);
  store.markUnseen(task);
  store.delete(task.id, "alice");

  assert.deepEqual(
    store.database.client.prepare("SELECT * FROM task_seen").all(),
    [],
  );
});

test("tasks from before seen tracking start seen through their newest event", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "seen-migration-"));
  t.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const folder = join(dir, "migrations");
  mkdirSync(folder);
  const initial = "20261014084019_initial";

  cpSync(join(migrationsFolder, initial), join(folder, initial), {
    recursive: true,
  });

  const path = join(dir, "console.sqlite");
  const before = openDatabase(path, folder);
  const insertTask = before.client.prepare("INSERT INTO tasks VALUES(?,?,?)");
  insertTask.run("replied", "alice", "{}");
  insertTask.run("quiet", "alice", "{}");

  const insertEvent = before.client.prepare(
    "INSERT INTO events(task_id, type, timestamp, data) VALUES(?,?,?,?)",
  );

  insertEvent.run("replied", "agent.reply", "now", "{}");
  insertEvent.run("replied", "task.turn_ended", "now", "{}");
  before.close();

  const after = openDatabase(path);
  t.onTestFinished(() => after.close());

  assert.deepEqual(
    after.client
      .prepare(
        "SELECT task_id, through, unseen FROM task_seen ORDER BY task_id",
      )
      .all()
      .map((row) => ({ ...row })),
    [
      { task_id: "quiet", through: 0, unseen: 0 },
      { task_id: "replied", through: 2, unseen: 0 },
    ],
  );
});

test("a task's seen state keeps where the user stopped reading", (t) => {
  const { store, task } = fixture(t);
  const first = store.event(task, "agent.reply", { text: "One", turn: 1 });
  store.markSeen(task, first.id);
  store.event(task, "agent.reply", { text: "Two", turn: 1 });

  assert.deepEqual(store.seen(task.id), { unseen: true, through: first.id });
});
