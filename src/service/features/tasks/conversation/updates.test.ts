import assert from "node:assert/strict";

import { test } from "vitest";

import { startSchema, type Task } from "../../../../shared/tasks/model.js";
import { Store } from "../storage/store.js";
import { Drafts } from "./drafts.js";
import { waitForUpdates } from "./updates.js";

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
