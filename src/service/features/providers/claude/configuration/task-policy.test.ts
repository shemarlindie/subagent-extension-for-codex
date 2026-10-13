import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test } from "vitest";

import { readClaudeTaskOptions } from "../../../../../shared/providers/claude/task-options.js";
import { startSchema, type Task } from "../../../../../shared/tasks/model.js";
import { Settings } from "../../../settings/settings.js";
import { Store } from "../../../tasks/storage/store.js";
import { claudeTaskPolicy } from "./task-policy.js";

const claudeOptions = (task: { provider_options?: Task["provider_options"] }) =>
  readClaudeTaskOptions(task as Task);

test("Claude preparation preserves native modes and restrictions independently of execution approval", () => {
  const store = new Store(":memory:");

  try {
    const defaults = new Settings(store.database, () => ["claude"]).values(
      "alice",
    );

    const input = startSchema.parse({
      repository: "/repo",
      description: "Review",
    });

    const prepared = claudeTaskPolicy.prepareStart({
      input,
      defaults,
      authority: "user",
    });

    const preparedOptions = claudeOptions(prepared);
    assert.equal(preparedOptions.permission_mode, "default");
    assert.equal(preparedOptions.permission_source, "setting");
    assert.equal(preparedOptions.claude_policy?.tools, "restricted");
    assert.equal(preparedOptions.claude_policy?.path_guard, true);

    assert.equal(
      claudeTaskPolicy.decideInput({ ...input } as unknown as Task, "Bash"),
      undefined,
    );

    assert.equal(
      claudeTaskPolicy.parentMayApprove({
        ...input,
        provider_options: { claude: { approval_decider: "parent_agent" } },
      } as unknown as Task),
      true,
    );

    assert.equal(
      claudeTaskPolicy.parentMayApprove({
        ...input,
        provider_options: { claude: { approval_decider: "user" } },
      } as unknown as Task),
      false,
    );
  } finally {
    store.close();
  }
});

test("Claude task-level inherit resolves to the configured extension Auto mode", () => {
  const store = new Store(":memory:");

  try {
    const settings = new Settings(store.database, () => ["claude"]);
    settings.update("alice", { set: { claude_permission_mode: "auto" } });

    const input = startSchema.parse({
      repository: "/repo",
      description: "Implement",
      worker_profile: "reviewer",
      provider_options: { claude: { permission_mode: "inherit" } },
    });

    const prepared = claudeTaskPolicy.prepareStart({
      input,
      defaults: settings.values("alice"),
      authority: "user",
    });

    const options = claudeOptions(prepared);
    assert.equal(options.permission_mode, "auto");
    assert.equal(options.permission_source, "setting");
    assert.equal(options.claude_policy?.tools, "restricted");
    assert.equal(options.claude_policy?.path_guard, true);
  } finally {
    store.close();
  }
});

test("Claude preparation checks native permission, approval decider, and effort before starting", () => {
  const store = new Store(":memory:");

  try {
    const defaults = new Settings(store.database, () => ["claude"]).values(
      "alice",
    );

    const input = startSchema.parse({
      repository: "/repo",
      description: "Review",
    });

    const prepare = (overrides: Partial<typeof input>) =>
      claudeTaskPolicy.prepareStart({
        input: { ...input, ...overrides },
        defaults,
        authority: "parent",
      });

    assert.throws(
      () => prepare({ approval_mode: "ask_user" }),
      /Claude uses permission_mode and approval_decider/,
    );

    assert.throws(
      () =>
        prepare({
          provider_options: {
            claude: { permission_mode: "bypassPermissions" },
          },
        }),
      /exceeds the user-approved native mode/,
    );

    assert.throws(
      () =>
        prepare({
          provider_options: { claude: { approval_decider: "parent_agent" } },
        }),
      /requires user authorization/,
    );

    for (const reasoning_effort of ["none", "minimal"] as const) {
      assert.throws(
        () => prepare({ reasoning_effort }),
        /Claude reasoning effort/,
      );
    }

    defaults.default_approval_decider = "parent_agent";

    assert.doesNotThrow(() =>
      prepare({
        provider_options: { claude: { approval_decider: "parent_agent" } },
        reasoning_effort: "high",
      }),
    );

    const prepared = prepare({
      provider_options: { claude: { permission_mode: "plan" } },
    });

    assert.equal(claudeOptions(prepared).permission_mode, "plan");
    assert.equal(claudeOptions(prepared).permission_source, "task");
  } finally {
    store.close();
  }
});

test("Claude continuation validates filesystem session references without imposing that rule on other providers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "claude-policy-"));
  const path = join(dir, "session.jsonl");

  try {
    await assert.rejects(
      claudeTaskPolicy.validateSession!({ session_state_ref: path } as Task),
      /ENOENT/,
    );

    await writeFile(path, "session");

    await assert.doesNotReject(
      claudeTaskPolicy.validateSession!({ session_state_ref: path } as Task),
    );

    await assert.doesNotReject(claudeTaskPolicy.validateSession!({} as Task));
  } finally {
    await rm(dir, { recursive: true });
  }
});
