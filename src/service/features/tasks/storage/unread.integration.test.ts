import assert from "node:assert/strict";

import { test } from "vitest";

import { startSchema, type Task } from "../../../../shared/tasks/model.js";
import { Store } from "./store.js";

function fixture(t: { onTestFinished(fn: () => void): void }) {
  const store = new Store(":memory:");
  t.onTestFinished(() => store.close());

  const task: Task = {
    ...startSchema.parse({ repository: "/repo", description: "Review" }),
    title: "Review",
    id: "read",
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

test("a task is unread once it has a reply, outcome or request after what the user saw", (t) => {
  const { store, task } = fixture(t);

  // The user's own messages leave it read.
  store.event(task, "task.started", { turn: 1 });

  store.event(task, "task.instruction", {
    message: "More",
    message_id: "msg_more",
    from: "user",
    delivery: "queue",
  });

  assert.equal(store.readState(task.id).unread, false);

  const reply = store.event(task, "agent.reply", { text: "Done", turn: 1 });
  assert.equal(store.readState(task.id).unread, true);

  store.markRead(task, reply.id);
  assert.equal(store.readState(task.id).unread, false);

  for (const type of [
    "agent.message",
    "task.turn_ended",
    "task.failed",
    "agent.input_required",
  ]) {
    const event = store.eventOpaque(task, type);
    assert.equal(store.readState(task.id).unread, true, type);
    store.markRead(task, event.id);
    assert.equal(store.readState(task.id).unread, false, type);
  }
});

test("reading an earlier event never undoes a later one, nor marks events still to come", (t) => {
  const { store, task } = fixture(t);
  const first = store.event(task, "agent.reply", { text: "One", turn: 1 });
  const second = store.event(task, "agent.reply", { text: "Two", turn: 1 });

  store.markRead(task, first.id);
  assert.equal(store.readState(task.id).unread, true);

  store.markRead(task, second.id);
  store.markRead(task, first.id);
  assert.equal(store.readState(task.id).unread, false);

  // A cursor past the newest event marks only what exists now.
  store.markRead(task, second.id + 100);
  store.event(task, "agent.reply", { text: "Three", turn: 1 });
  assert.equal(store.readState(task.id).unread, true);

  // Without a cursor, everything so far is read.
  store.markRead(task);
  assert.equal(store.readState(task.id).unread, false);
});

test("marking unread from an event leaves what came before it read, even moving the read point back", (t) => {
  const { store, task } = fixture(t);
  const first = store.event(task, "agent.reply", { text: "One", turn: 1 });
  const second = store.event(task, "agent.reply", { text: "Two", turn: 1 });
  store.markRead(task);

  store.markUnreadFrom(task, second.id);

  assert.deepEqual(store.readState(task.id), {
    unread: true,
    through: first.id,
  });

  store.markUnreadFrom(task, first.id);

  assert.deepEqual(store.readState(task.id), {
    unread: true,
    through: first.id - 1,
  });

  store.markRead(task);
  assert.equal(store.readState(task.id).unread, false);
});

test("marking read or unread announces a change without touching the task", (t) => {
  const { store, task } = fixture(t);
  const before = store.get(task.id, "alice");
  const revision = store.revision("alice");

  store.markUnread(task);
  const unread = store.revision("alice");
  assert.notEqual(unread, revision);

  store.markRead(task);
  assert.notEqual(store.revision("alice"), unread);
  assert.deepEqual(store.get(task.id, "alice"), before);
});

test("deleting a task deletes what the user saw of it", (t) => {
  const { store, task } = fixture(t);
  store.markUnread(task);
  store.delete(task.id, "alice");

  assert.deepEqual(
    store.database.client.prepare("SELECT * FROM task_read").all(),
    [],
  );
});

test("a task's read state keeps where the user stopped reading", (t) => {
  const { store, task } = fixture(t);
  const first = store.event(task, "agent.reply", { text: "One", turn: 1 });
  store.markRead(task, first.id);
  store.event(task, "agent.reply", { text: "Two", turn: 1 });

  assert.deepEqual(store.readState(task.id), {
    unread: true,
    through: first.id,
  });
});
