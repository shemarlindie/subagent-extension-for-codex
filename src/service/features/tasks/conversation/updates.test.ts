import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";

import { test, type TestContext } from "vitest";

import { startSchema, type Task } from "../../../../core/shared/tasks/model.js";
import { Store } from "../storage/store.js";
import { Drafts } from "./drafts.js";
import { UpdateWaits, waitForUpdates } from "./updates.js";

/** Holds update waits that last until a change or a replacement ends them. */
function replacementHarness(t: TestContext) {
  const store = new Store(":memory:");
  t.onTestFinished(() => store.close());
  const drafts = new Drafts(store.bus);
  const waits = new UpdateWaits();

  return {
    store,
    wait: (owner: string, ids: { wait_id?: string; replaces?: string }) =>
      waitForUpdates(store, drafts, waits, owner, {
        after: store.revision(owner),
        wait_ms: 20000,
        ...ids,
      }),
  };
}

/** Whether `wait` still holds after a moment. */
async function holds(wait: Promise<unknown>) {
  return (await Promise.race([wait, sleep(50, "held")])) === "held";
}

test("a replacing wait ends the wait it replaces and then holds", async (t) => {
  const { store, wait } = replacementHarness(t);
  const replaced = wait("alice", { wait_id: "a" });
  const replacing = wait("alice", { wait_id: "b", replaces: "a" });

  assert.deepEqual(await replaced, { revision: store.revision("alice") });
  assert.equal(await holds(replacing), true);
  store.markChanged("alice");
  await replacing;
});

test("a replacement that arrives first ends the replaced wait on arrival", async (t) => {
  const { store, wait } = replacementHarness(t);
  const replacing = wait("alice", { wait_id: "b", replaces: "a" });
  const replaced = wait("alice", { wait_id: "a" });

  assert.equal(await holds(replaced), false);
  store.markChanged("alice");
  await replacing;
});

test("a replacement leaves another owner's wait with the same id held", async (t) => {
  const { store, wait } = replacementHarness(t);
  const bobs = wait("bob", { wait_id: "a" });
  const alices = wait("alice", { replaces: "a" });

  assert.equal(await holds(bobs), true);
  store.markChanged("bob");
  store.markChanged("alice");
  await Promise.all([bobs, alices]);
});

test("a view and its revision include a write that lands while the view waits for projects", async (t) => {
  const store = new Store(":memory:");
  t.onTestFinished(() => store.close());

  const task: Task = {
    ...startSchema.parse({ repository: "/repo", description: "Move them" }),
    id: "task",
    title: "Move them",
    owner: "alice",
    created_by: "user",
    status: "completed",
    created_at: "",
    updated_at: "",
    instructions_sent: 0,
    pending_steers: [],
    queue: [],
    turn: 1,
    runtime_ms: 0,
  };

  store.save(task);

  const read = await waitForUpdates(
    store,
    new Drafts(store.bus),
    new UpdateWaits(),
    "alice",
    { wait_ms: 0 },
    async () => {
      store.save({ ...task, title: "Renamed" });

      return () => ({
        revision: store.revision("alice"),
        title: store.get(task.id, "alice").title,
      });
    },
  );

  const revision = store.revision("alice");
  assert.deepEqual(read, { revision, view: { revision, title: "Renamed" } });
});
