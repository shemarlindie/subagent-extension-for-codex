import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { Store } from "../src/core/store.js";
import { Workspaces } from "../src/core/workspace.js";
import { Control } from "../src/core/control.js";
import { FixtureProvider } from "../src/providers/fixture.js";
import { Settings } from "../src/core/settings.js";
import {
  startSchema,
  type RunContext,
  type Result,
} from "../src/core/model.js";
import {
  claudePermissionModes,
  parentPermissionsFromMeta,
  closestClaudeMode,
  resolveClaudePermission,
} from "../src/core/permissions.js";

test("native permission resolution follows task, setting, parent, then profile", () => {
  const task = { worker_profile: "implementer" };
  assert.deepEqual(resolveClaudePermission(task, "inherit"), {
    mode: "acceptEdits",
    source: "task_profile",
  });
  assert.deepEqual(
    resolveClaudePermission({ worker_profile: "reviewer" }, "inherit"),
    { mode: "plan", source: "task_profile" },
  );
  const parent = {
    provider: "claude" as const,
    permission_mode: "auto" as const,
  };
  assert.deepEqual(resolveClaudePermission(task, "inherit", parent), {
    mode: "auto",
    source: "parent",
  });
  assert.deepEqual(
    resolveClaudePermission(
      { worker_profile: "researcher" },
      "inherit",
      parent,
    ),
    { mode: "plan", source: "parent" },
  );
  assert.deepEqual(resolveClaudePermission(task, "dontAsk", parent), {
    mode: "dontAsk",
    source: "setting",
  });
  assert.deepEqual(
    resolveClaudePermission(
      { ...task, permission_mode: "default" },
      "dontAsk",
      parent,
    ),
    { mode: "default", source: "task" },
  );
});

test("validated parent metadata maps host permissions to the closest native mode", () => {
  const host = (sandbox: string, approval: string) =>
    parentPermissionsFromMeta({
      "codex/sandbox-state-meta": {
        sandboxPolicy: { type: sandbox },
        approvalPolicy: approval,
      },
    });
  assert.equal(closestClaudeMode(host("read-only", "never")), "plan");
  assert.equal(
    closestClaudeMode(host("workspace-write", "on-request")),
    "acceptEdits",
  );
  assert.equal(
    closestClaudeMode(host("workspace-write", "auto-review")),
    "auto",
  );
  assert.equal(
    closestClaudeMode(host("danger-full-access", "never")),
    "bypassPermissions",
  );
  assert.equal(
    closestClaudeMode(host("workspace-write", "untrusted")),
    "default",
  );
  assert.equal(closestClaudeMode(host("read-only", "unknown-policy")), "plan");
  assert.equal(host("invalid", "invalid"), undefined);
  assert.equal(
    parentPermissionsFromMeta({ permission_mode: "bypassPermissions" }),
    undefined,
  );
  assert.equal(
    parentPermissionsFromMeta({
      "codex-subagent-extension/parent-permissions": {
        provider: "claude",
        permission_mode: "invalid",
      },
    }),
    undefined,
  );
  assert.equal(
    closestClaudeMode(
      parentPermissionsFromMeta({
        "codex-subagent-extension/parent-permissions": {
          provider: "claude",
          permission_mode: "dontAsk",
        },
      }),
    ),
    "dontAsk",
  );
});

test("custom parent metadata cannot shadow more restrictive Codex host metadata", () => {
  for (const custom of [
    { provider: "claude", permission_mode: "bypassPermissions" },
    { provider: "claude" },
  ]) {
    for (const [sandbox, approval, expected] of [
      ["read-only", "never", "plan"],
      ["workspace-write", "untrusted", "default"],
    ]) {
      assert.equal(
        closestClaudeMode(
          parentPermissionsFromMeta({
            "codex-subagent-extension/parent-permissions": custom,
            "codex/sandbox-state-meta": {
              sandboxPolicy: { type: sandbox },
              approvalPolicy: approval,
            },
          }),
        ),
        expected,
      );
    }
  }
  assert.equal(
    closestClaudeMode(
      parentPermissionsFromMeta({
        "codex-subagent-extension/parent-permissions": {
          provider: "claude",
          permission_mode: "dontAsk",
        },
        "codex/sandbox-state-meta": {
          sandboxPolicy: { type: "workspace-write" },
          approvalPolicy: "never",
        },
      }),
    ),
    "dontAsk",
  );
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
  t.after(async () => {
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

test("native settings expose all SDK modes, persist overrides, and require user authority", async (t) => {
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
  assert.equal(task.permission_mode, "acceptEdits");
  assert.equal(task.permission_source, "task_profile");
  const inherited = await c.start("alice", request, "parent", {
    provider: "claude",
    permission_mode: "default",
  });
  assert.equal(store.get(inherited.id, "alice").permission_mode, "default");
  assert.equal(store.get(inherited.id, "alice").permission_source, "parent");
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
  const restricted = await c.start(
    "alice",
    { ...request, permission_mode: "dontAsk" },
    "parent",
  );
  assert.equal(restricted.permission_mode, "dontAsk");
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

test("parent task inheritance requires ownership and settings override parent mode", async (t) => {
  const { c } = await setup(t);
  const parent = await c.start("alice", {
    ...request,
    permission_mode: "default",
  });
  await assert.rejects(
    c.start("bob", { ...request, parent_task_id: parent.id }, "parent"),
  );
  const child = await c.start(
    "alice",
    { ...request, parent_task_id: parent.id },
    "parent",
  );
  assert.equal(child.permission_mode, "default");
  assert.equal(child.permission_source, "parent");
  c.settings.update("alice", { set: { claude_permission_mode: "dontAsk" } });
  const overridden = await c.start(
    "alice",
    { ...request, parent_task_id: parent.id },
    "parent",
  );
  assert.equal(overridden.permission_mode, "dontAsk");
  assert.equal(overridden.permission_source, "setting");
});

test("referencing a permissive parent task cannot exceed actual host or read-only parent authority", async (t) => {
  const { c } = await setup(t);
  assert.equal(c.settings.values("alice").claude_permission_mode, "inherit");
  const permissive = await c.start("alice", {
    ...request,
    permission_mode: "bypassPermissions",
  });
  const host = {
    provider: "codex" as const,
    sandbox_mode: "read-only" as const,
    approval_policy: "never" as const,
  };
  const restrictedByHost = await c.start(
    "alice",
    { ...request, parent_task_id: permissive.id },
    "parent",
    host,
  );
  assert.equal(restrictedByHost.permission_mode, "plan");
  assert.equal(restrictedByHost.permission_source, "parent");
  await assert.rejects(
    c.start(
      "alice",
      {
        ...request,
        parent_task_id: permissive.id,
        permission_mode: "acceptEdits",
      },
      "parent",
      host,
    ),
    /exceeds the user-approved native mode/,
  );
  const reviewer = await c.start("alice", {
    ...request,
    worker_profile: "reviewer",
    permission_mode: "bypassPermissions",
  });
  const restrictedByProfile = await c.start(
    "alice",
    { ...request, parent_task_id: reviewer.id },
    "parent",
  );
  assert.equal(restrictedByProfile.permission_mode, "plan");
  assert.equal(restrictedByProfile.permission_source, "parent");
  c.settings.update("alice", {
    set: { claude_permission_mode: "acceptEdits" },
  });
  const userOverride = await c.start(
    "alice",
    { ...request, parent_task_id: reviewer.id },
    "parent",
  );
  assert.equal(userOverride.permission_mode, "acceptEdits");
  assert.equal(userOverride.permission_source, "setting");
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
