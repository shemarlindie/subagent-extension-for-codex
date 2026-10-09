import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test, type TestContext } from "vitest";

import { openDatabase } from "../../platform/database/database.js";
import { tasks } from "../tasks/schema.js";
import { EventStorage } from "./storage.js";

function queuedDelivery(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "event-storage-"));
  const db = openDatabase(join(dir, "console.sqlite"));

  t.onTestFinished(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  db.orm
    .insert(tasks)
    .values({ id: "task-1", owner: "chat-1", body: "{}" })
    .run();

  const storage = new EventStorage(db);

  storage.enqueue(
    "subscription-1",
    "evt_task-1_1",
    "task-1",
    '{"payload":"unchanged"}',
  );

  return { db, storage };
}

test("returns validated ready deliveries with migrated defaults and unchanged body", (t) => {
  const { storage } = queuedDelivery(t);

  expect(storage.ready(0)).toEqual([
    {
      subscription_id: "subscription-1",
      event_id: "evt_task-1_1",
      task_id: "task-1",
      body: '{"payload":"unchanged"}',
      status: "ready",
      attempts: 0,
      next_at: 0,
    },
  ]);
});

test("rejects a corrupt persisted delivery with the subscription and event name", (t) => {
  const { db, storage } = queuedDelivery(t);

  // SQLite permits text in an INTEGER column; Drizzle's TS type cannot detect it.
  db.client.exec("UPDATE event_outbox SET attempts='corrupt'");

  expect(() => storage.ready(0)).toThrow(
    "Stored webhook delivery subscription-1/evt_task-1_1 is malformed:",
  );
});
