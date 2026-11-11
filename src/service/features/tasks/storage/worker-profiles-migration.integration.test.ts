import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test } from "vitest";

import { task } from "../../../../../dev/service/fixture-provider-test-helpers.js";
import { Settings } from "../../settings/settings.js";
import { Store } from "./store.js";

const MIGRATION = "20261110171602_worker-profiles";

test("removed worker profiles move to reviewer or implementer, and their saved settings go", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "worker-profiles-migration-"));
  const path = join(dir, "service.sqlite");
  let store = new Store(path);

  t.onTestFinished(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  new Settings(store.database, () => ["claude"]).update("alice", {
    set: { profiles: { reviewer: { instructions: "Check tests" } } },
  });

  store.database.client
    .prepare(
      `UPDATE user_settings SET body = json_set(body,
        '$.task.worker_profile', 'security_reviewer',
        '$.models.profiles.general', json('{"model":"opus"}'),
        '$.profiles.debugger', json('{"instructions":"Bisect first"}'))
      WHERE owner = 'alice'`,
    )
    .run();

  const profiles = {
    task_general: "general",
    task_debugger: "debugger",
    task_tests: "test_engineer",
    task_refactor: "refactorer",
    task_security: "security_reviewer",
    task_researcher: "researcher",
  };

  for (const [id, worker_profile] of Object.entries(profiles)) {
    store.save({ ...task(id), worker_profile } as never);
  }

  // Reopening applies the migration to rows stored before it.
  store.database.client
    .prepare("DELETE FROM __drizzle_migrations WHERE name = ?")
    .run(MIGRATION);

  store.close();
  store = new Store(path);
  const values = new Settings(store.database, () => ["claude"]).values("alice");

  assert.equal(values.task.worker_profile, "reviewer");

  assert.deepEqual(Object.keys(values.models.profiles).sort(), [
    "implementer",
    "researcher",
    "reviewer",
  ]);

  assert.equal(values.profiles.reviewer.instructions, "Check tests");

  assert.deepEqual(
    Object.keys(profiles).map((id) => store.get(id, "alice").worker_profile),
    [
      "implementer",
      "implementer",
      "implementer",
      "implementer",
      "reviewer",
      "researcher",
    ],
  );
});
