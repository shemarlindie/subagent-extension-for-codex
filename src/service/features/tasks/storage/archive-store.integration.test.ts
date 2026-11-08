import assert from "node:assert/strict";

import { test } from "vitest";

import { startSchema, type Task } from "../../../../shared/tasks/model.js";
import { ArchiveStore } from "./archive-store.js";
import { Store } from "./store.js";

function fixture(t: { onTestFinished(fn: () => void): void }) {
  const store = new Store(":memory:");
  t.onTestFinished(() => store.close());
  const archive = new ArchiveStore(store);

  const save = (id: string, patch: Partial<Task> = {}) => {
    const task: Task = {
      ...startSchema.parse({ repository: "/repo", description: "Review" }),
      title: "Review",
      id,
      owner: "alice",
      status: "completed",
      created_at: "now",
      updated_at: "now",
      created_by: "user",
      instructions_sent: 0,
      pending_steers: [],
      queue: [],
      turn: 1,
      runtime_ms: 0,
      ...patch,
    };

    store.save(task);

    return task;
  };

  return { store, archive, save };
}

test("archive times are scoped to the owner and go with a deleted task", (t) => {
  const { store, archive, save } = fixture(t);
  save("mine");
  save("theirs", { owner: "bob" });

  archive.setArchived("alice", ["mine"], true);
  archive.setArchived("bob", ["theirs"], true);
  assert.deepEqual([...archive.times("alice").keys()], ["mine"]);

  store.database.client
    .prepare("UPDATE task_archive SET archived_at = ? WHERE task_id = ?")
    .run("2000-01-01T00:00:00.000Z", "mine");

  archive.setArchived("alice", ["mine"], true);
  assert.equal(archive.times("alice").get("mine"), "2000-01-01T00:00:00.000Z");

  store.delete("mine", "alice");
  assert.equal(archive.times("alice").size, 0);
});

test("archiving skips tasks that could still need the user", (t) => {
  const { archive, save } = fixture(t);
  save("done");
  save("running", { status: "running" });

  save("asking", {
    status: "interrupted",
    pending_input: {
      id: "i",
      tool: "AskUserQuestion",
      kind: "question",
      input: {},
    },
  });

  save("queued", {
    status: "interrupted",
    queue: [{ id: "m", message: "Next", from: "user", delivery: "queue" }],
  });

  assert.deepEqual(
    archive.setArchived("alice", ["done", "running", "asking", "queued"], true),
    { task_ids: ["done"], skipped: ["running", "asking", "queued"] },
  );

  // Unarchiving skips nothing.
  assert.deepEqual(archive.setArchived("alice", ["done", "running"], false), {
    task_ids: ["done", "running"],
    skipped: [],
  });

  assert.throws(() => archive.setArchived("bob", ["done"], true), /not found/);
});
