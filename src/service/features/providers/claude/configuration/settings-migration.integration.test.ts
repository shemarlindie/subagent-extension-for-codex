import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test } from "vitest";

import { task } from "../../../../../../dev/service/fixture-provider-test-helpers.js";
import { readClaudeTaskOptions } from "../../../../../shared/providers/claude/task-options.js";
import { Settings } from "../../../settings/settings.js";
import { Store } from "../../../tasks/storage/store.js";

const MIGRATION = "20261107064009_claude-sdk-settings";

/** A task as stored before the migration, with the removed restrictions. */
const oldTask = (
  id: string,
  worker_profile: string,
  sandbox: string,
  tools: string,
  path_guard: boolean,
) => ({
  ...task(id),
  provider: "claude",
  worker_profile,
  provider_options: {
    claude: {
      permission_mode: "default",
      approval_decider: "user",
      permission_source: "setting",
      claude_policy: {
        sandbox,
        tools,
        path_guard,
        subagents: false,
        settings_files: true,
        user_mcp: true,
      },
    },
  },
});

test("saved sandbox presets become the toggle, and restricted read-only tasks move to plan mode", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "claude-settings-migration-"));
  const path = join(dir, "service.sqlite");
  let store = new Store(path);

  t.onTestFinished(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  const oldSettings = store.database.client.prepare(
    `UPDATE user_settings SET body = json_set(body,
      '$.providers.claude.sandbox', ?,
      '$.providers.claude.tools', 'restricted',
      '$.providers.claude.path_guard', 'on') WHERE owner = ?`,
  );

  for (const [owner, sandbox] of [
    ["alice", "extension_locked"],
    ["bob", "user_config"],
  ] as const) {
    new Settings(store.database, () => ["claude"]).update(owner, {
      set: { providers: { claude: { subagents: false } } },
    });

    oldSettings.run(sandbox, owner);
  }

  for (const old of [
    oldTask("task_restricted", "reviewer", "user_config", "restricted", true),
    oldTask("task_loosened", "reviewer", "extension", "all", false),
    oldTask("task_writer", "implementer", "extension", "restricted", true),
  ]) {
    store.save(old as never);
  }

  // Reopening applies the migration to rows stored before it.
  store.database.client
    .prepare("DELETE FROM __drizzle_migrations WHERE name = ?")
    .run(MIGRATION);

  store.close();
  store = new Store(path);
  const settings = new Settings(store.database, () => ["claude"]);

  assert.equal(settings.values("alice").providers.claude.sandbox, true);
  assert.equal(settings.values("bob").providers.claude.sandbox, false);

  const options = (id: string) => {
    const stored = readClaudeTaskOptions(store.get(id, "alice"));

    return [stored.permission_mode, stored.claude_policy];
  };

  const policy = (sandbox: boolean) => ({
    sandbox,
    subagents: false,
    settings_files: true,
    user_mcp: true,
  });

  assert.deepEqual(options("task_restricted"), ["plan", policy(false)]);
  assert.deepEqual(options("task_loosened"), ["default", policy(true)]);
  assert.deepEqual(options("task_writer"), ["default", policy(true)]);
});
