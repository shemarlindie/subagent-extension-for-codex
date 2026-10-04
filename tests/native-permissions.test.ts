import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test, type TestContext } from "vitest";

import { Control } from "../src/core/control.js";
import {
  type Result,
  type RunContext,
  startSchema,
} from "../src/core/model.js";
import {
  claudeOverrideDefaults,
  claudePermissionModes,
  exceedsPermission,
  resolveClaudePermission,
  resolveClaudePolicy,
} from "../src/core/permissions.js";
import { Settings } from "../src/core/settings.js";
import { Store } from "../src/core/store.js";
import { Workspaces } from "../src/core/workspace.js";
import { FixtureProvider } from "../src/providers/fixture.js";

test("native permission resolution follows task, setting, then profile or the user's Claude Code settings", () => {
  const task = { worker_profile: "implementer" };

  assert.deepEqual(resolveClaudePermission(task, "inherit"), {
    mode: "inherit",
    source: "user_config",
  });

  assert.deepEqual(
    resolveClaudePermission({ worker_profile: "reviewer" }, "inherit"),
    { mode: "plan", source: "task_profile" },
  );

  assert.deepEqual(
    resolveClaudePermission({ worker_profile: "reviewer" }, "acceptEdits"),
    { mode: "acceptEdits", source: "setting" },
  );

  assert.deepEqual(resolveClaudePermission(task, "dontAsk"), {
    mode: "dontAsk",
    source: "setting",
  });

  assert.deepEqual(
    resolveClaudePermission({ ...task, permission_mode: "default" }, "dontAsk"),
    { mode: "default", source: "task" },
  );
});

test("model-selected modes cannot exceed a known baseline or the unknown authority of Claude Code settings", () => {
  assert.equal(exceedsPermission("inherit", "inherit"), false);
  for (const mode of ["plan", "dontAsk"] as const)
    assert.equal(exceedsPermission(mode, "inherit"), false, mode);
  for (const mode of [
    "default",
    "acceptEdits",
    "auto",
    "bypassPermissions",
  ] as const)
    assert.equal(exceedsPermission(mode, "inherit"), true, mode);
  assert.equal(exceedsPermission("inherit", "bypassPermissions"), true);
  assert.equal(exceedsPermission("default", "acceptEdits"), false);
  assert.equal(exceedsPermission("auto", "acceptEdits"), true);
});

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

  const c = new Control(
    store,
    new Workspaces(join(dir, "worktrees"), [repo]),
    new Map([["claude", provider]]),
    repo,
    1,
  );

  t.onTestFinished(async () => {
    await c.close();
    await rm(dir, { recursive: true, force: true });
  });

  return { c, store };
}

const request = {
  provider: "claude",
  description: "Implement a change",
  worker_profile: "implementer",
  workspace_strategy: "current_repo",
};

test("settings expose all SDK permission modes, persist overrides, and require user authority", async (t) => {
  const { c, store } = await setup(t);
  const settings = c.settings;
  assert.equal(settings.values("alice").claude_permission_mode, "inherit");
  const properties = settings.read("alice").schema.properties!;

  assert.deepEqual(properties.claude_permission_mode.enum, [
    "inherit",
    ...claudePermissionModes,
  ]);

  assert.equal(Object.hasOwn(properties, "default_approval_mode"), false);
  for (const key of Object.keys(settings.read("alice").values))
    assert.ok(
      Object.hasOwn(properties, key),
      `${key} needs a host schema property`,
    );

  assert.throws(
    () =>
      settings.update(
        "alice",
        { set: { claude_permission_mode: "bypassPermissions" } },
        "parent",
      ),
    /user decision/,
  );

  settings.update("alice", {
    set: {
      claude_permission_mode: "dontAsk",
      default_approval_decider: "parent_agent",
    },
  });

  const reloaded = new Settings(store, () => ["claude"]);
  assert.equal(reloaded.values("alice").claude_permission_mode, "dontAsk");

  assert.equal(
    reloaded.values("alice").default_approval_decider,
    "parent_agent",
  );

  assert.equal(reloaded.values("bob").claude_permission_mode, "inherit");
});

test("legacy saved approval preferences migrate to native mode and decider", async (t) => {
  const { c, store } = await setup(t);

  for (const [owner, legacy, mode, decider] of [
    ["parent", "parent_agent", "default", "parent_agent"],
    ["automatic", "auto_approve", "bypassPermissions", "user"],
    ["denied", "deny", "dontAsk", "user"],
  ]) {
    store.db.prepare("INSERT INTO user_settings VALUES(?,?)").run(
      owner,
      JSON.stringify({
        ...c.settings.values("alice"),
        default_approval_mode: legacy,
        claude_permission_mode: undefined,
        default_approval_decider: undefined,
      }),
    );

    assert.equal(c.settings.values(owner).claude_permission_mode, mode);
    assert.equal(c.settings.values(owner).default_approval_decider, decider);
  }
});

test("task arguments cannot spoof parent permissions and resolved source is stored", async (t) => {
  const { c, store } = await setup(t);

  const task = await c.start(
    "alice",
    {
      ...request,
      parent_permissions: {
        provider: "claude",
        permission_mode: "bypassPermissions",
      },
    },
    "parent",
  );

  assert.equal(task.permission_mode, "inherit");
  assert.equal(store.get(task.id, "alice").permission_source, "user_config");

  assert.equal(
    Object.hasOwn(
      startSchema.parse({
        ...request,
        parent_permissions: { permission_mode: "auto" },
      }),
      "parent_permissions",
    ),
    false,
  );
});

test("parent cannot increase native permissions or grant itself decision authority", async (t) => {
  const { c } = await setup(t);

  await assert.rejects(
    c.start(
      "alice",
      { ...request, permission_mode: "bypassPermissions" },
      "parent",
    ),
    /exceeds the user-approved native mode/,
  );

  await assert.rejects(
    c.start(
      "alice",
      { ...request, approval_decider: "parent_agent" },
      "parent",
    ),
    /user authorization/,
  );

  await assert.rejects(
    c.start("alice", { ...request, permission_mode: "acceptEdits" }, "parent"),
    /exceeds the user-approved native mode/,
  );

  const restricted = await c.start(
    "alice",
    { ...request, permission_mode: "dontAsk" },
    "parent",
  );

  assert.equal(restricted.permission_mode, "dontAsk");

  await assert.rejects(
    c.start(
      "alice",
      { ...request, worker_profile: "reviewer", permission_mode: "dontAsk" },
      "parent",
    ),
    /exceeds the user-approved native mode/,
  );

  c.settings.update("alice", {
    set: {
      claude_permission_mode: "bypassPermissions",
      default_approval_decider: "parent_agent",
    },
  });

  const approved = await c.start(
    "alice",
    { ...request, permission_mode: "auto", approval_decider: "parent_agent" },
    "parent",
  );

  assert.equal(approved.permission_mode, "auto");
  assert.equal(approved.approval_decider, "parent_agent");
});

test("parent task references require ownership and do not pass on the parent's mode", async (t) => {
  const { c } = await setup(t);

  const parent = await c.start("alice", {
    ...request,
    permission_mode: "bypassPermissions",
  });

  await assert.rejects(
    c.start("bob", { ...request, parent_task_id: parent.id }, "parent"),
  );

  const child = await c.start(
    "alice",
    { ...request, parent_task_id: parent.id },
    "parent",
  );

  assert.equal(child.permission_mode, "inherit");
  assert.equal(child.permission_source, "user_config");
  c.settings.update("alice", { set: { claude_permission_mode: "dontAsk" } });

  const overridden = await c.start(
    "alice",
    { ...request, parent_task_id: parent.id },
    "parent",
  );

  assert.equal(overridden.permission_mode, "dontAsk");
  assert.equal(overridden.permission_source, "setting");
});

class PromptProvider extends FixtureProvider {
  async run(ctx: RunContext): Promise<Result> {
    const answer = await ctx.input(
      "Write",
      { file_path: "README.md" },
      ctx.signal,
    );

    return {
      summary: JSON.stringify(answer),
      findings: [],
      evidence: [],
      changes: [],
      tests: [],
      recommendations: [],
    };
  }
}

async function until(predicate: () => boolean) {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("Timed out waiting for native permission request");
}

test("explicit legacy task modes select their original decider unless native routing overrides it", async (t) => {
  const { c } = await setup(t);

  c.settings.update("alice", {
    set: { default_approval_decider: "parent_agent" },
  });

  for (const [approval_mode, permission_mode, approval_decider] of [
    ["ask_user", "default", "user"],
    ["parent_agent", "default", "parent_agent"],
    ["auto_approve", "bypassPermissions", "user"],
    ["deny", "dontAsk", "user"],
  ]) {
    const task = await c.start("alice", { ...request, approval_mode });
    assert.equal(task.permission_mode, permission_mode);
    assert.equal(task.approval_decider, approval_decider);
  }

  const override = await c.start("alice", {
    ...request,
    approval_mode: "ask_user",
    permission_mode: "dontAsk",
    approval_decider: "parent_agent",
  });

  assert.equal(override.permission_mode, "dontAsk");
  assert.equal(override.approval_decider, "parent_agent");
});

test("persisted Claude tasks retain legacy approval routing with explicit native precedence", async (t) => {
  const { c, store } = await setup(t, new PromptProvider());

  for (const [approval_mode, nativeDecider, parentAllowed] of [
    ["parent_agent", undefined, true],
    ["ask_user", undefined, false],
    ["parent_agent", "user", false],
  ] as const) {
    const task = await c.start("alice", { ...request, approval_mode });
    await until(() => !!store.get(task.id, "alice").pending_input);
    const persisted = store.get(task.id, "alice");
    delete persisted.permission_mode;
    delete persisted.permission_source;
    persisted.approval_decider = nativeDecider;
    store.save(persisted);
    const pending = persisted.pending_input!;

    if (!parentAllowed) {
      for (const approved of [true, false])
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
      JSON.parse(store.get(task.id, "alice").result!.summary).approved,
      false,
    );
  }
});

test("native unresolved approvals honor user or parent decision settings independently of legacy auto policy", async (t) => {
  const { c, store } = await setup(t, new PromptProvider());

  c.settings.update("alice", {
    set: {
      default_approval_mode: "auto_approve",
      claude_permission_mode: "default",
      default_approval_decider: "user",
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
    set: { default_approval_decider: "parent_agent" },
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
    JSON.parse(store.get(delegated.id, "alice").result!.summary).approved,
    false,
  );
});

test("Claude tasks snapshot session restrictions from settings and ignore task arguments", async (t) => {
  const { c, store } = await setup(t);

  c.settings.update("alice", {
    set: {
      claude_sandbox: "extension_locked",
      claude_environment: "filtered",
      claude_subagents: false,
    },
  });

  // A model-supplied policy cannot widen the user's settings.
  const write = await c.start(
    "alice",
    {
      ...request,
      claude_policy: {
        sandbox: "user_config",
        environment: "inherit",
        tools: "all",
        path_guard: false,
        subagents: true,
      },
    },
    "parent",
  );

  assert.deepEqual(store.get(write.id, "alice").claude_policy, {
    sandbox: "extension_locked",
    environment: "filtered",
    tools: "all",
    path_guard: false,
    subagents: false,
  });

  const review = await c.start("alice", {
    ...request,
    worker_profile: "reviewer",
  });

  assert.equal(review.claude_policy?.tools, "restricted");
  assert.equal(review.claude_policy?.path_guard, true);
  // A later settings change does not alter started tasks.
  c.settings.update("alice", { set: { claude_tools: "restricted" } });
  assert.equal(store.get(write.id, "alice").claude_policy?.tools, "all");
  const bob = await c.start("bob", request);

  assert.deepEqual(
    bob.claude_policy,
    resolveClaudePolicy(claudeOverrideDefaults, "implementer"),
  );
});

test("profile restriction values restrict read-only profiles and explicit values apply to all", () => {
  const profile = {
    ...claudeOverrideDefaults,
    claude_tools: "profile",
    claude_path_guard: "profile",
  } as const;

  for (const role of ["researcher", "reviewer", "security_reviewer"])
    assert.deepEqual(
      [
        resolveClaudePolicy(profile, role).tools,
        resolveClaudePolicy(profile, role).path_guard,
      ],
      ["restricted", true],
    );
  for (const role of ["implementer", "debugger", "test_engineer", "refactorer"])
    assert.deepEqual(
      [
        resolveClaudePolicy(profile, role).tools,
        resolveClaudePolicy(profile, role).path_guard,
      ],
      ["all", false],
    );

  const loosened = resolveClaudePolicy(
    { ...profile, claude_tools: "all", claude_path_guard: "off" },
    "reviewer",
  );

  assert.equal(loosened.tools, "all");
  assert.equal(loosened.path_guard, false);
});
