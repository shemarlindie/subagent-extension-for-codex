import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test, type TestContext } from "vitest";

import { FixtureProvider } from "../../../../dev/service/fixture-provider.js";
import { until } from "../../../../tests/support/until.js";
import { claudeTaskPolicy } from "../../../service/features/providers/claude/configuration/task-policy.js";
import {
  type RunContext,
  type TurnOutput,
} from "../../../service/features/providers/types.js";
import { Settings } from "../../../service/features/settings/settings.js";
import { Control } from "../../../service/features/tasks/runtime/control.js";
import { Store } from "../../../service/features/tasks/storage/store.js";
import { Workspaces } from "../../../service/features/workspaces/workspace.js";
import { settingPaths } from "../../settings/settings-schema.js";
import type { Task } from "../../tasks/model.js";
import { claudeMetadata } from "../metadata.js";
import {
  claudeOverrideDefaults,
  claudePermissionModes,
  resolveClaudePolicy,
} from "./permissions.js";
import { readClaudeTaskOptions } from "./task-options.js";

async function setup(t: TestContext, provider = new FixtureProvider()) {
  const dir = await mkdtemp(join(tmpdir(), "native-permissions-"));
  const repo = join(dir, "repo");
  await mkdir(repo);
  execFileSync("git", ["init", "-q", repo]);
  await writeFile(join(repo, "README.md"), "fixture\n");
  execFileSync("git", ["-C", repo, "add", "."]);

  execFileSync("git", [
    "-C",
    repo,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-qm",
    "initial",
  ]);

  const store = new Store(join(dir, "tasks.sqlite"));
  provider.id = "claude";
  provider.taskPolicy = claudeTaskPolicy;
  provider.metadata = claudeMetadata;

  const c = new Control(
    store,
    new Workspaces(join(dir, "worktrees"), [repo]),
    new Map([["claude", provider]]),
    1,
  );

  t.onTestFinished(async () => {
    await c.close();
    await rm(dir, { recursive: true, force: true });
  });

  return { c, store, request: { ...baseRequest, repository: repo } };
}

const baseRequest = {
  provider: "claude",
  description: "Implement a change",
  worker_profile: "implementer",
  workspace_strategy: "current_repo",
};

const withClaudeOptions = (
  input: Record<string, unknown>,
  options: Record<string, unknown>,
) => ({
  ...input,
  provider_options: {
    ...((input.provider_options as Record<string, Record<string, unknown>>) ??
      {}),
    claude: options,
  },
});

const taskOptions = (task: Task) => readClaudeTaskOptions(task);

test("settings default to Default, expose only SDK permission modes, persist overrides, and require user authority", async (t) => {
  const { c, store } = await setup(t);
  const settings = c.settings;

  assert.equal(
    settings.values("alice").providers.claude.permission_mode,
    "default",
  );

  const { schema, values } = settings.read("alice");

  const property = (path: string) =>
    path
      .split(".")
      .reduce<Record<string, unknown> | undefined>(
        (node, key) =>
          (node?.properties as Record<string, Record<string, unknown>>)?.[key],
        schema,
      );

  assert.deepEqual(
    property("providers.claude.permission_mode")?.enum,
    claudePermissionModes,
  );

  assert.equal(property("providers")?.userOnly, true);

  for (const path of settingPaths(values)) {
    assert.ok(property(path), `${path} needs a host schema property`);
  }

  settings.update("alice", {
    set: {
      providers: { claude: { permission_mode: "dontAsk" } },
      approvals: { decider: "parent_agent" },
    },
  });

  const reloaded = new Settings(store.database, () => ["claude"]);

  assert.equal(
    reloaded.values("alice").providers.claude.permission_mode,
    "dontAsk",
  );

  assert.equal(reloaded.values("alice").approvals.decider, "parent_agent");

  assert.equal(
    reloaded.values("bob").providers.claude.permission_mode,
    "default",
  );
});

test("task-level inherit uses the extension's configured Auto mode", async (t) => {
  const { c, request } = await setup(t);

  c.settings.update("alice", {
    set: { providers: { claude: { permission_mode: "auto" } } },
  });

  const task = await c.start(
    "alice",
    withClaudeOptions(request, { permission_mode: "inherit" }),
    "user",
  );

  assert.equal(taskOptions(task).permission_mode, "auto");
  assert.equal(taskOptions(task).permission_source, "setting");
});

test("parent cannot increase native permissions or grant itself decision authority", async (t) => {
  const { c, request } = await setup(t);

  await assert.rejects(
    c.start(
      "alice",
      withClaudeOptions(request, { permission_mode: "bypassPermissions" }),
      "parent",
    ),
    /exceeds the user-approved native mode/,
  );

  await assert.rejects(
    c.start(
      "alice",
      withClaudeOptions(request, { approval_decider: "parent_agent" }),
      "parent",
    ),
    /user authorization/,
  );

  await assert.rejects(
    c.start(
      "alice",
      withClaudeOptions(request, { permission_mode: "acceptEdits" }),
      "parent",
    ),
    /exceeds the user-approved native mode/,
  );

  const restricted = await c.start(
    "alice",
    withClaudeOptions(request, { permission_mode: "dontAsk" }),
    "parent",
  );

  assert.equal(taskOptions(restricted).permission_mode, "dontAsk");

  const readOnlyLowerMode = await c.start(
    "alice",
    withClaudeOptions(
      { ...request, worker_profile: "reviewer" },
      { permission_mode: "dontAsk" },
    ),
    "parent",
  );

  assert.equal(taskOptions(readOnlyLowerMode).permission_mode, "dontAsk");

  await assert.rejects(
    c.start(
      "alice",
      withClaudeOptions(
        { ...request, worker_profile: "reviewer" },
        { permission_mode: "auto" },
      ),
      "parent",
    ),
    /exceeds the user-approved native mode/,
  );

  c.settings.update("alice", {
    set: {
      providers: { claude: { permission_mode: "bypassPermissions" } },
      approvals: { decider: "parent_agent" },
    },
  });

  const approved = await c.start(
    "alice",
    withClaudeOptions(request, {
      permission_mode: "auto",
      approval_decider: "parent_agent",
    }),
    "parent",
  );

  assert.equal(taskOptions(approved).permission_mode, "auto");
  assert.equal(taskOptions(approved).approval_decider, "parent_agent");
});

class PromptProvider extends FixtureProvider {
  override async run(ctx: RunContext): Promise<TurnOutput> {
    const answer = await ctx.input(
      "Write",
      { file_path: "README.md" },
      ctx.signal,
    );

    return {
      reply: JSON.stringify(answer),
    };
  }
}

test("new Claude tasks require native permission and decision fields", async (t) => {
  const { c, request } = await setup(t);

  for (const approval_mode of [
    "ask_user",
    "parent_agent",
    "auto_approve",
    "deny",
  ]) {
    await assert.rejects(
      c.start("alice", { ...request, approval_mode }),
      /Claude uses permission_mode and approval_decider/,
    );
  }

  const task = await c.start(
    "alice",
    withClaudeOptions(request, {
      permission_mode: "dontAsk",
      approval_decider: "parent_agent",
    }),
  );

  assert.equal(taskOptions(task).permission_mode, "dontAsk");
  assert.equal(taskOptions(task).approval_decider, "parent_agent");
});

test("persisted Claude tasks retain native approval routing", async (t) => {
  const { c, store, request } = await setup(t, new PromptProvider());

  for (const [nativeDecider, parentAllowed] of [
    ["parent_agent", true],
    ["user", false],
  ] as const) {
    const task = await c.start(
      "alice",
      withClaudeOptions(request, {
        permission_mode: "default",
        approval_decider: nativeDecider,
      }),
    );

    await until(() => !!store.get(task.id, "alice").pending_input);
    const persisted = store.get(task.id, "alice");
    store.save(persisted);
    const pending = persisted.pending_input!;

    if (!parentAllowed) {
      for (const approved of [true, false]) {
        assert.throws(
          () =>
            c.input(
              "alice",
              task.id,
              pending.id,
              approved,
              undefined,
              undefined,
              "parent",
            ),
          /requires user approval/,
        );
      }

      assert.equal(store.get(task.id, "alice").pending_input?.id, pending.id);
    }

    c.input(
      "alice",
      task.id,
      pending.id,
      false,
      undefined,
      undefined,
      parentAllowed ? "parent" : "user",
    );

    await until(() => store.get(task.id, "alice").status === "completed");

    assert.equal(
      JSON.parse(String(store.latestEvent(task.id, "agent.reply")!.data.text))
        .approved,
      false,
    );
  }
});

test("native unresolved approvals honor their decision setting independently of execution defaults", async (t) => {
  const { c, store, request } = await setup(t, new PromptProvider());

  c.settings.update("alice", {
    set: {
      approvals: { execution_mode: "auto_approve", decider: "user" },
      providers: { claude: { permission_mode: "default" } },
    },
  });

  const task = await c.start("alice", request);
  await until(() => !!store.get(task.id, "alice").pending_input);
  const pending = store.get(task.id, "alice").pending_input!;
  assert.equal(pending.tool, "Write");

  assert.throws(
    () =>
      c.input(
        "alice",
        task.id,
        pending.id,
        true,
        undefined,
        undefined,
        "parent",
      ),
    /requires user approval/,
  );

  c.input("alice", task.id, pending.id, true, undefined, undefined, "user");
  await until(() => store.get(task.id, "alice").status === "completed");

  c.settings.update("alice", {
    set: { approvals: { decider: "parent_agent" } },
  });

  const delegated = await c.start("alice", request, "parent");
  await until(() => !!store.get(delegated.id, "alice").pending_input);
  const delegatedPending = store.get(delegated.id, "alice").pending_input!;

  c.input(
    "alice",
    delegated.id,
    delegatedPending.id,
    false,
    undefined,
    "Parent declined",
    "parent",
  );

  await until(() => store.get(delegated.id, "alice").status === "completed");

  assert.equal(
    JSON.parse(
      String(store.latestEvent(delegated.id, "agent.reply")!.data.text),
    ).approved,
    false,
  );
});

test("Claude tasks snapshot session restrictions from settings and ignore task arguments", async (t) => {
  const { c, store, request } = await setup(t);

  c.settings.update("alice", {
    set: {
      providers: {
        claude: {
          sandbox: "extension_locked",
          subagents: false,
          settings_files: false,
          user_mcp: false,
        },
      },
    },
  });

  // Provider-owned resolved restrictions cannot be supplied by the caller.
  await assert.rejects(
    c.start(
      "alice",
      withClaudeOptions(request, {
        claude_policy: {
          sandbox: "user_config",
          tools: "all",
          path_guard: false,
          subagents: true,
          settings_files: true,
          user_mcp: true,
        },
      }),
      "parent",
    ),
    /Unrecognized key/,
  );

  const write = await c.start("alice", request, "parent");

  assert.deepEqual(taskOptions(store.get(write.id, "alice")).claude_policy, {
    sandbox: "extension_locked",
    tools: "all",
    path_guard: false,
    subagents: false,
    settings_files: false,
    user_mcp: false,
  });

  const review = await c.start("alice", {
    ...request,
    worker_profile: "reviewer",
  });

  assert.equal(taskOptions(review).claude_policy.tools, "restricted");
  assert.equal(taskOptions(review).claude_policy.path_guard, true);

  // A later settings change does not alter started tasks.
  c.settings.update("alice", {
    set: {
      providers: {
        claude: { tools: "restricted", settings_files: true, user_mcp: true },
      },
    },
  });

  const storedPolicy = taskOptions(store.get(write.id, "alice")).claude_policy;
  assert.equal(storedPolicy.tools, "all");
  assert.equal(storedPolicy.settings_files, false);
  assert.equal(storedPolicy.user_mcp, false);

  const bob = await c.start("bob", request);

  assert.deepEqual(
    taskOptions(bob).claude_policy,
    resolveClaudePolicy(claudeOverrideDefaults, "implementer"),
  );
});
