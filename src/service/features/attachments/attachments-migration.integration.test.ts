import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test } from "vitest";

import { task } from "../../../../dev/service/fixture-provider-test-helpers.js";
import { Store } from "../tasks/storage/store.js";
import { Attachments } from "./attachments.js";

const MIGRATIONS = [
  "20261122045348_request-attachment-ids",
  "20261122045358_attachments-by-message",
];

test("request attachments stored before the message key keep their place and file", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "attachments-migration-"));
  const path = join(dir, "service.sqlite");
  let store = new Store(path);

  t.onTestFinished(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  store.save(task("task_old"));
  const { client } = store.database;

  // The table as it was, with a request attachment and its NULL message id.
  client.exec("DROP TABLE task_attachments");

  client.exec(
    await readFile(
      "migrations/20261110025216_task-attachments/migration.sql",
      "utf8",
    ),
  );

  client
    .prepare(
      `INSERT INTO task_attachments (task_id, position, title, summary, format, source, file, chars, lines)
      VALUES ('task_old', 1, 'Note', 'A decision.', 'text', 'inline', '1-note.txt', 1, 1)`,
    )
    .run();

  for (const name of MIGRATIONS) {
    client.prepare("DELETE FROM __drizzle_migrations WHERE name = ?").run(name);
  }

  store.close();
  store = new Store(path);

  assert.deepEqual(
    new Attachments(store, join(dir, "attachments"))
      .list("task_old", "request")
      .map((a) => [a.position, a.file]),
    [[1, "1-note.txt"]],
  );
});
