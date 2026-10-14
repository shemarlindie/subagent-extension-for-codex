import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test, vi } from "vitest";

import { FixtureProvider } from "../../../../../dev/service/fixture-provider.js";
import { claudeMetadata } from "../../../../shared/providers/metadata.js";
import type { ModelChoice } from "../../../../shared/providers/types.js";
import { claudeTaskPolicy } from "../../providers/claude/configuration/task-policy.js";
import { type ProviderTaskPolicy } from "../../providers/task-policy.js";
import type {
  Provider,
  RunContext,
  TurnOutput,
} from "../../providers/types.js";
import { Workspaces } from "../../workspaces/workspace.js";
import { Store } from "../storage/store.js";
import { Control } from "./control.js";

const pause = (ms = 10) => new Promise((r) => setTimeout(r, ms));

async function until(fn: () => boolean) {
  for (let i = 0; i < 300; i++) {
    if (fn()) return;
    await pause();
  }

  throw new Error("Timed out");
}

async function setup(
  provider: Provider = new FixtureProvider(),
  concurrency = 2,
) {
  const dir = await mkdtemp(join(tmpdir(), "codex-subagent-extension-test-"));
  const repo = join(dir, "repo");
  await mkdir(repo);
  execFileSync("git", ["init", "-q", repo]);

  execFileSync("git", [
    "-C",
    repo,
    "config",
    "user.email",
    "test@example.invalid",
  ]);

  execFileSync("git", ["-C", repo, "config", "user.name", "Test"]);
  await writeFile(join(repo, "README.md"), "hello\n");
  execFileSync("git", ["-C", repo, "add", "."]);
  execFileSync("git", ["-C", repo, "commit", "-qm", "initial"]);
  const db = join(dir, "tasks.sqlite");
  const store = new Store(db);

  const c = new Control(
    store,
    new Workspaces(join(dir, "worktrees"), [repo]),
    new Map([[provider.id, provider]]),
    concurrency,
  );

  return { dir, repo, db, store, c };
}

const input = (repository: string, description = "Investigate") => ({
  provider: "fixture",
  repository,
  title: "Investigate task",
  description,
  workspace_strategy: "worktree",
});

test("worker discovery exposes SDK metadata and falls back when discovery fails", async () => {
  const provider: Provider = new FixtureProvider();

  const models: ModelChoice[] = [
    {
      value: "known-model",
      displayName: "Known",
      description: "",
      supportsEffort: true,
      supportedEffortLevels: ["low", "high"],
    },
  ];

  provider.models = async () => models;
  const { c } = await setup(provider);

  try {
    const [worker] = await c.availableWorkers();
    assert.ok(worker);
    assert.deepEqual((worker as any).models, models);
    assert.equal(worker.provider, "fixture");

    provider.models = async () => {
      throw new Error("unavailable");
    };

    const fallback = (await c.availableWorkers())[0] as any;
    assert.equal(fallback.models, undefined);
    assert.match(fallback.model_discovery_error, /Model discovery unavailable/);
    assert.deepEqual(fallback.profiles, worker.profiles);
    assert.deepEqual(fallback.capabilities, worker.capabilities);
  } finally {
    await c.close();
  }
});

test("an unready provider blocks task starts and model discovery but stays listed", async () => {
  const provider: Provider = new FixtureProvider();
  let discoveries = 0;

  provider.models = async () => {
    discoveries++;

    return [];
  };

  provider.readiness = async () => ({
    ready: false,
    message: "Claude Code was not found on the service's PATH.",
    details: { supported_versions: "2.1.285+" },
  });

  const { c, store, repo } = await setup(provider);

  try {
    const [worker] = (await c.availableWorkers()) as any[];
    assert.equal(worker.readiness.ready, false);
    assert.equal(worker.models, undefined);
    assert.equal(worker.model_discovery_error, undefined);
    assert.equal(discoveries, 0);

    await assert.rejects(
      c.start("alice", input(repo)),
      /not found on the service/,
    );

    assert.deepEqual(store.all("alice"), []);

    provider.readiness = async () => ({ ready: true, details: {} });

    assert.equal(
      ((await c.availableWorkers())[0] as any).readiness.ready,
      true,
    );

    assert.equal(discoveries, 1);
  } finally {
    await c.close();
  }
});

test("known model effort metadata rejects invalid work before queueing while unknown metadata permits execution", async () => {
  const provider: Provider = new FixtureProvider();

  provider.models = async () => [
    {
      value: "default",
      displayName: "Runtime default",
      description: "",
      supportsEffort: false,
    },
    {
      value: "no-effort",
      displayName: "No effort",
      description: "",
      supportsEffort: false,
    },
    {
      value: "limited-effort",
      displayName: "Limited effort",
      description: "",
      supportedEffortLevels: ["low"],
    },
    { value: "unknown-effort", displayName: "Unknown effort", description: "" },
  ];

  const { c, store, repo } = await setup(provider);

  try {
    await assert.rejects(
      c.start("alice", { ...input(repo), reasoning_effort: "high" }),
      /does not support reasoning effort high/,
    );

    assert.equal(store.all().length, 0);

    for (const model of ["no-effort", "limited-effort"]) {
      await assert.rejects(
        c.start("alice", { ...input(repo), model, reasoning_effort: "high" }),
        /does not support reasoning effort high/,
      );

      assert.equal(store.all().length, 0);
    }

    for (const model of ["unknown-effort", "custom-model"]) {
      const task = await c.start("alice", {
        ...input(repo),
        model,
        reasoning_effort: "high",
      });

      await until(() => store.get(task.id, "alice").status === "completed");
      assert.equal(task.model, model);
    }

    const supported = await c.start("alice", {
      ...input(repo),
      model: "limited-effort",
      reasoning_effort: "low",
    });

    await until(() => store.get(supported.id, "alice").status === "completed");

    provider.models = async () => {
      throw new Error("Discovery unavailable");
    };

    const unavailable = await c.start("alice", {
      ...input(repo),
      model: "custom-model",
      reasoning_effort: "high",
    });

    await until(
      () => store.get(unavailable.id, "alice").status === "completed",
    );
  } finally {
    await c.close();
  }
});

test("Claude rejects unsupported direct and inherited effort before persisting or running work", async () => {
  const provider = new FixtureProvider();
  provider.id = "claude";
  provider.taskPolicy = claudeTaskPolicy;
  provider.metadata = claudeMetadata;
  let calls = 0;
  const run = provider.run.bind(provider);

  provider.run = async (...args) => {
    calls++;

    return run(...args);
  };

  const { c, store, repo } = await setup(provider);

  try {
    for (const reasoning_effort of ["none", "minimal"]) {
      await assert.rejects(
        c.start("alice", {
          ...input(repo),
          provider: "claude",
          reasoning_effort,
        }),
        /Claude reasoning effort/,
      );

      c.settings.update("alice", {
        set: { default_reasoning_effort: reasoning_effort },
      });

      await assert.rejects(
        c.start("alice", { ...input(repo), provider: "claude" }),
        /Claude reasoning effort/,
      );

      assert.equal(store.all().length, 0);
      assert.equal(calls, 0);
    }

    const task = await c.start("alice", {
      ...input(repo),
      provider: "claude",
      reasoning_effort: "high",
    });

    await until(() => store.get(task.id, "alice").status === "completed");
    assert.equal(task.reasoning_effort, "high");
    assert.equal(calls, 1);
  } finally {
    await c.close();
  }
});

test("task titles come from trimmed descriptions while workers receive full instructions", async () => {
  const provider = new FixtureProvider();
  const original = provider.run.bind(provider);
  let received: string | undefined;

  provider.run = async (ctx, prompt) => {
    received = prompt;

    return original(ctx, prompt);
  };

  const { c, store, repo } = await setup(provider);

  try {
    const task = await c.start("alice", {
      ...input(repo),
      description: "  Full instructions\nwith detailed evidence.  ",
    });

    await until(() => store.get(task.id, "alice").status === "completed");
    assert.equal(task.title, "Full instructions");

    assert.equal(
      task.description,
      "Full instructions\nwith detailed evidence.",
    );

    assert.equal(received, task.description);
    assert.equal(store.get(task.id, "alice").title, task.title);
    assert.equal(store.get(task.id, "alice").description, task.description);
  } finally {
    await c.close();
  }
});

test("invalid descriptions cannot persist or execute a task", async () => {
  const provider = new FixtureProvider();
  let runs = 0;

  provider.run = async () => {
    runs++;
    throw new Error("Unexpected execution");
  };

  const { c, store, repo } = await setup(provider);

  try {
    const cases = [
      { description: undefined },
      { description: "" },
      { description: " \n\t " },
      { description: "x".repeat(20001) },
    ];

    for (const invalid of cases) {
      await assert.rejects(c.start("alice", { ...input(repo), ...invalid }));
      assert.equal(store.all().length, 0);
    }

    assert.equal(runs, 0);
  } finally {
    await c.close();
  }
});

test("user defaults persist across restart, preserve omitted fields and remain owner-scoped", async () => {
  const { c, db } = await setup();

  c.settings.update("alice", {
    set: {
      max_runtime_minutes: 8,
      use_runtime_budget: true,
      default_worker_profile: "implementer",
    },
  });

  c.settings.update("alice", {
    set: { max_cost_usd: 2, use_cost_budget: true },
  });

  assert.equal(c.settings.values("alice").max_runtime_minutes, 8);
  assert.equal(c.settings.values("bob").max_runtime_minutes, null);
  const read = c.settings.read("alice");
  assert.equal(read.values.max_cost_usd, 2);

  assert.ok(
    Object.values(read.schema.properties!).every((p: any) => !("default" in p)),
  );

  await c.close();
  const reopened = new Store(db);
  const { Settings } = await import("../../settings/settings.js");
  const settings = new Settings(reopened.database, () => ["fixture"]);
  assert.equal(settings.values("alice").default_worker_profile, "implementer");
  assert.equal(settings.values("alice").max_cost_usd, 2);
  reopened.close();
});

test("task tools honor defaults and explicit overrides without changing existing tasks", async () => {
  const { c, repo } = await setup();
  const { callTool } = await import("../../../platform/server/tools.js");

  c.settings.update("alice", {
    set: {
      max_runtime_minutes: 9,
      use_runtime_budget: true,
      max_cost_usd: 3,
      use_cost_budget: true,
      default_worker_profile: "implementer",
    },
  });

  const task: any = await callTool(c, "alice", "start_agent_task", {
    repository: repo,
    description: "Test default merge",
    budget: { max_cost_usd: 1 },
  });

  assert.equal(task.provider, "fixture");
  assert.equal(task.worker_profile, "implementer");
  assert.equal(task.budget.max_runtime_minutes, 9);
  assert.equal(task.budget.max_cost_usd, 1);
  c.settings.update("alice", { set: { max_runtime_minutes: 7 } });
  assert.equal(c.store.get(task.id, "alice").budget.max_runtime_minutes, 9);

  const other: any = await callTool(c, "bob", "start_agent_task", {
    repository: repo,
    title: "Other owner defaults",
    description: "Other owner defaults",
  });

  assert.equal(other.worker_profile, "reviewer");
  assert.equal(other.budget.max_runtime_minutes, null);
  assert.equal(other.budget.max_cost_usd, null);
  await c.close();
});

test("settings reject unsupported providers, invalid budgets, unknown fields and empty updates atomically", async () => {
  const { c } = await setup();
  const original = c.settings.values("alice");

  for (const set of [
    { default_provider: "claude", max_cost_usd: 1 },
    { max_runtime_minutes: 0 },
    { max_cost_usd: 0 },
    { approval_policy: "allow_all" },
    {},
  ]) {
    assert.throws(() => c.settings.update("alice", { set }));
    assert.deepEqual(c.settings.values("alice"), original);
  }

  await c.close();
});

test("durable task completes in isolated worktree and records its reply", async () => {
  const { c, store, repo, db } = await setup();
  const t = await c.start("alice", input(repo));
  await until(() => store.get(t.id, "alice").status === "completed");
  const done = store.get(t.id, "alice");
  assert.notEqual(done.workspace, repo);
  assert.equal(done.session_owner, c.ownerWorker);
  assert.ok(done.session_state_ref);
  const reply = store.latestEvent(t.id, "agent.reply")!;
  assert.ok(String(reply.data.text).includes("Fixture"));
  assert.equal(reply.data.turn, 1);
  assert.equal(reply.data.start_tree, done.turn_start_tree);
  assert.match(String(reply.data.end_tree), /^[0-9a-f]{40}$/);

  // Each replied turn's snapshots are pinned under the turn.
  for (const name of ["start", "end"]) {
    assert.equal(
      execFileSync("git", [
        "-C",
        repo,
        "rev-parse",
        `refs/agent-tasks/${t.id}/turns/1/${name}`,
      ])
        .toString()
        .trim(),
      reply.data[`${name}_tree`],
    );
  }

  const completed = store
    .events(t.id, "alice")
    .find((e) => e.type === "task.completed")!;

  assert.deepEqual(completed.data, { reply: reply.data.text });
  await c.close();
  const reopened = new Store(db);
  assert.equal(reopened.get(t.id, "alice").status, "completed");
  reopened.close();
});

test("fixture invalid-session marker triggers the normal continuation recovery path", async () => {
  const { c, store, repo } = await setup();

  const t = await c.start(
    "alice",
    input(repo, "[fixture:session state=invalid]"),
  );

  await until(() => store.get(t.id, "alice").status === "completed");
  assert.match(store.get(t.id, "alice").session_state_ref!, /:invalid$/);

  await c.send("alice", t.id, "Continue", "user");
  await until(() => store.get(t.id, "alice").turn === 2);
  await until(() => store.get(t.id, "alice").status === "completed");

  assert.deepEqual(
    store
      .events(t.id, "alice")
      .find((event) => event.type === "task.session_started")?.data,
    { reason: "session_unavailable" },
  );

  assert.doesNotMatch(store.get(t.id, "alice").session_state_ref!, /:invalid$/);
  await c.close();
});

test("ownership enforced across dependencies, state, events and controls", async () => {
  const { c, store, repo } = await setup();
  const t = await c.start("alice", input(repo, "[input]"));
  await until(() => store.get(t.id, "alice").status === "waiting");
  assert.throws(() => store.get(t.id, "bob"));
  assert.throws(() => store.events(t.id, "bob"));
  await assert.rejects(c.interrupt("bob", t.id));
  await assert.rejects(c.send("bob", t.id, "Hi", "user"));
  await assert.rejects(c.delete("bob", t.id));
  await assert.rejects(c.start("bob", { ...input(repo), depends_on: [t.id] }));
  await c.close();
});

test("dependents wait on an interrupted dependency and fail with a failed one, and a follow-up resumes them", async () => {
  const { c, store, repo } = await setup();
  const first = await c.start("alice", input(repo, "[input]"));

  const second = await c.start("alice", {
    ...input(repo, "Review result"),
    depends_on: [first.id],
  });

  await until(() => store.get(first.id, "alice").status === "waiting");
  await until(() => store.get(second.id, "alice").status === "waiting");
  await c.interrupt("alice", first.id);

  // An interrupted dependency keeps its dependents waiting, and names it.
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(store.get(second.id, "alice").status, "waiting");
  assert.equal(store.get(second.id, "alice").waiting_for, first.id);

  assert.deepEqual(
    store
      .events(second.id, "alice")
      .filter((e) => e.type === "task.waiting")
      .at(-1)?.data,
    { reason: "waiting_for_dependency", dependency_id: first.id },
  );

  // A failed dependency still fails them.
  await c.send("alice", first.id, "[fail]", "user");
  await until(() => store.get(first.id, "alice").status === "failed");
  await until(() => store.get(second.id, "alice").status === "failed");

  assert.equal(
    store.get(second.id, "alice").error,
    `Dependency ${first.id} failed`,
  );

  assert.equal(store.get(second.id, "alice").workspace, undefined);

  // Once the dependency completes, a follow-up resumes the dependent.
  await c.send("alice", first.id, "Try again", "user");
  await until(() => store.get(first.id, "alice").status === "completed");
  await c.send("alice", second.id, "Go ahead", "user");
  await until(() => store.get(second.id, "alice").status === "completed");
  await c.close();
});

test("dependent prompts include each dependency's reply and workspace diff", async () => {
  const prompts = new Map<string, string>();

  class Writer extends FixtureProvider {
    override async run(c: RunContext, p: string) {
      prompts.set(c.task.id, p);

      if (c.task.description === "Write") {
        await writeFile(
          join(c.task.workspace!, "added.ts"),
          "export const added = 1;\n",
        );
      }

      return super.run(c, p);
    }
  }

  const { c, store, repo } = await setup(new Writer());
  const first = await c.start("alice", input(repo, "Write"));

  const second = await c.start("alice", {
    ...input(repo, "Review"),
    depends_on: [first.id],
  });

  await until(() => store.get(second.id, "alice").status === "completed");
  const prompt = prompts.get(second.id)!;

  assert.ok(
    prompt.includes(
      `Dependency ${first.id} replied:\nFixture task completed. No Claude execution occurred.`,
    ),
  );

  assert.match(prompt, /changes \(1 file, \+1 −0\), as a diff/);
  assert.match(prompt, /\+export const added = 1;/);

  // Once the worktree is removed, the dependent sees the branch's commits;
  // the uncommitted file went with the worktree.
  const { branch, workspace } = store.get(first.id, "alice");
  execFileSync("git", ["-C", workspace!, "worktree", "remove", "--force", "."]);

  const third = await c.start("alice", {
    ...input(repo, "Review again"),
    depends_on: [first.id],
  });

  await until(() => store.get(third.id, "alice").status === "completed");

  assert.ok(
    prompts
      .get(third.id)!
      .includes(
        `worktree was removed, and its branch ${branch} has no committed changes.`,
      ),
  );

  await c.close();
});

test("current_repo dependents see only the dependency's own changes", async () => {
  const prompts = new Map<string, string>();

  class Writer extends FixtureProvider {
    override async run(c: RunContext, p: string) {
      prompts.set(c.task.id, p);

      if (c.task.description === "Write") {
        await writeFile(join(c.task.workspace!, "worker.ts"), "worker\n");
      }

      return super.run(c, p);
    }
  }

  const { c, store, repo } = await setup(new Writer());
  await writeFile(join(repo, "user.ts"), "user\n");
  const current = { workspace_strategy: "current_repo" };
  const first = await c.start("alice", { ...input(repo, "Write"), ...current });

  const second = await c.start("alice", {
    ...input(repo, "Review"),
    ...current,
    depends_on: [first.id],
  });

  await until(() => store.get(second.id, "alice").status === "completed");

  const [, dependency] = prompts
    .get(second.id)!
    .split(`Dependency ${first.id} changes`);

  assert.ok(dependency);
  assert.match(dependency, /\+worker/);
  assert.doesNotMatch(dependency, /\+user/);
  await c.close();
});

test("successful dependencies release and task hierarchy stays separate", async () => {
  const { c, store, repo } = await setup();
  const a = await c.start("alice", input(repo));

  const b = await c.start("alice", {
    ...input(repo),
    depends_on: [a.id],
    parent_task_id: a.id,
  });

  await until(() => store.get(b.id, "alice").status === "completed");

  const starts = store
    .events(b.id, "alice")
    .find((e) => e.type === "task.started")!;

  const completed = store
    .events(a.id, "alice")
    .find((e) => e.type === "task.completed")!;

  assert.ok(starts.id > completed.id);
  await c.close();
});

test("human input is durable and stale input IDs are rejected", async () => {
  const { c, store, repo } = await setup();
  const t = await c.start("alice", input(repo, "[input]"));
  await until(() => !!store.get(t.id, "alice").pending_input);
  const request = store.get(t.id, "alice").pending_input!;
  assert.throws(() => c.input("alice", t.id, "stale", true));

  c.input("alice", t.id, request.id, true, {
    answer: "preserve compatibility",
  });

  assert.throws(() => c.input("alice", t.id, request.id, true));
  await until(() => store.get(t.id, "alice").status === "completed");
  assert.equal(store.get(t.id, "alice").pending_input, undefined);
  await c.close();
});

test("interrupt preserves the session, and a follow-up resumes it with only the new message", async () => {
  const prompts: string[] = [];

  class Recorder extends FixtureProvider {
    override async run(c: RunContext, p: string) {
      prompts.push(p);

      return super.run(c, p);
    }
  }

  const { c, store, repo } = await setup(new Recorder());
  const t = await c.start("alice", input(repo, "[input]"));
  await until(() => !!store.get(t.id, "alice").pending_input);
  await c.interrupt("alice", t.id);
  const previous = store.get(t.id, "alice").session_id;
  assert.ok(store.get(t.id, "alice").completed_at);
  await c.send("alice", t.id, "Carry on [input]", "parent");
  await until(() => !!store.get(t.id, "alice").pending_input);

  c.input("alice", t.id, store.get(t.id, "alice").pending_input!.id, true, {
    answer: "yes",
  });

  await until(() => store.get(t.id, "alice").status === "completed");
  const done = store.get(t.id, "alice");
  assert.equal(done.session_id, previous);
  assert.equal(done.turn, 2);
  assert.equal(done.instructions_sent, 1);
  // The resumed session already holds the request, so it gets only the message.
  assert.equal(prompts[1], "Carry on [input]");

  assert.ok(
    !store.events(t.id, "alice").some((e) => e.type === "task.session_started"),
  );

  await c.close();
});

test("a follow-up without a resumable session starts a new one carrying the conversation", async () => {
  const prompts: string[] = [];

  class Recorder extends FixtureProvider {
    override async run(c: RunContext, p: string) {
      prompts.push(p);

      return super.run(c, p);
    }
  }

  const { c, store, repo } = await setup(new Recorder());
  const t = await c.start("alice", input(repo, "Review the parser"));
  await until(() => store.get(t.id, "alice").status === "completed");
  await c.send("alice", t.id, "Check the lexer too", "parent");
  await until(() => store.get(t.id, "alice").turn === 2);
  await until(() => store.get(t.id, "alice").status === "completed");

  // The session is on another worker now, so it can't resume.
  const moved = store.get(t.id, "alice");
  moved.session_owner = "another-worker";
  store.save(moved);
  await c.send("alice", t.id, "Summarise both", "user");
  await until(() => store.get(t.id, "alice").turn === 3);
  await until(() => store.get(t.id, "alice").status === "completed");

  assert.deepEqual(
    store
      .events(t.id, "alice")
      .filter((e) => e.type === "task.session_started")
      .map((e) => e.data),
    [{ reason: "session_unavailable" }],
  );

  const prompt = prompts[2];
  assert.ok(prompt);
  // The first turn's prompt, then the earlier conversation, then the message.
  assert.ok(prompt.startsWith("Review the parser"));
  assert.match(prompt, /continues in a new session/);
  assert.match(prompt, /Parent agent:\nCheck the lexer too/);
  assert.match(prompt, /Your reply:\nFixture task completed/);
  assert.ok(prompt.endsWith("Summarise both"));

  assert.ok(
    prompt.indexOf("Check the lexer too") < prompt.indexOf("Summarise both"),
  );

  assert.equal(store.get(t.id, "alice").session_owner, c.ownerWorker);

  // A task that failed before its session existed starts one, too.
  const early = await c.start("alice", input(repo, "Early"));
  await until(() => store.get(early.id, "alice").status === "completed");
  const failed = store.get(early.id, "alice");
  failed.status = "failed";
  delete failed.session_id;
  store.save(failed);
  await c.send("alice", early.id, "Try once more", "user");
  await until(() => store.get(early.id, "alice").status === "completed");

  assert.deepEqual(
    store
      .events(early.id, "alice")
      .filter((e) => e.type === "task.session_started")
      .map((e) => e.data),
    [{ reason: "no_session" }],
  );

  await c.close();
});

test("a completed task takes a follow-up as its next turn, with its own turn scope", async () => {
  class Writer extends FixtureProvider {
    override async run(c: RunContext, p: string) {
      await writeFile(
        join(c.task.workspace!, `turn-${c.task.turn}.txt`),
        `${c.task.turn}\n`,
      );

      return super.run(c, p);
    }
  }

  const { c, store, repo } = await setup(new Writer());
  const t = await c.start("alice", input(repo, "Write"));
  await until(() => store.get(t.id, "alice").status === "completed");
  const first = store.get(t.id, "alice");
  assert.ok(first.completed_at);
  assert.equal(first.created_by, "user");

  const sent = await c.send("alice", t.id, "Write another", "parent");
  assert.match(sent.message_id, /^msg_/);
  assert.equal(sent.task.completed_at, undefined);
  await until(() => store.get(t.id, "alice").turn === 2);
  await until(() => store.get(t.id, "alice").status === "completed");
  const done = store.get(t.id, "alice");
  assert.ok(done.runtime_ms >= first.runtime_ms);

  const paths = async (scope: "task" | "turn") =>
    (await c.workspaces.changes(done, scope)).files.map((f) => f.path);

  assert.deepEqual(await paths("turn"), ["turn-2.txt"]);
  assert.deepEqual(await paths("task"), ["turn-1.txt", "turn-2.txt"]);

  const events = store.events(t.id, "alice");

  assert.deepEqual(events.find((e) => e.type === "task.instruction")?.data, {
    message_id: sent.message_id,
    message: "Write another",
    from: "parent",
    delivery: "steer",
  });

  assert.deepEqual(
    events.filter((e) => e.type === "agent.reply").map((e) => e.data.turn),
    [1, 2],
  );

  // A busy task takes no follow-up yet.
  const busy = await c.start("alice", input(repo, "[input]"));
  await until(() => !!store.get(busy.id, "alice").pending_input);

  await assert.rejects(
    c.send("alice", busy.id, "Hi", "user"),
    /waiting for input/,
  );

  await c.close();
});

test("a turn stopped by its budget resumes after a follow-up raises it", async () => {
  const { c, store, repo } = await setup();

  const t = await c.start("alice", {
    ...input(repo),
    budget: { max_runtime_minutes: 20, max_cost_usd: 1 },
  });

  await until(() => store.get(t.id, "alice").status === "completed");
  const spent = store.get(t.id, "alice");
  spent.cost_usd = 1;
  store.save(spent);
  await c.send("alice", t.id, "More", "user");
  await until(() => store.get(t.id, "alice").status === "failed");
  assert.match(store.get(t.id, "alice").error!, /Cost budget exhausted/);

  // Each limit can only go up.
  await assert.rejects(
    c.send("alice", t.id, "More", "user", {
      budget: { max_cost_usd: 0.5 },
    }),
    /can only be raised/,
  );

  await assert.rejects(
    c.send("alice", t.id, "More", "user", {
      budget: { max_runtime_minutes: 19 },
    }),
    /can only be raised/,
  );

  assert.equal(store.get(t.id, "alice").status, "failed");

  await c.send("alice", t.id, "More", "parent", {
    budget: { max_cost_usd: 2, max_runtime_minutes: null },
  });

  await until(() => store.get(t.id, "alice").status === "completed");

  assert.deepEqual(store.get(t.id, "alice").budget, {
    max_cost_usd: 2,
    max_runtime_minutes: null,
  });

  // No limit can't become a limit again.
  await assert.rejects(
    c.send("alice", t.id, "More", "user", {
      budget: { max_runtime_minutes: 30 },
    }),
    /can only be raised/,
  );

  await c.close();
});

test("applying an increased limit persists without starting a turn", async () => {
  const { c, store, repo } = await setup();

  const task = await c.start("alice", {
    ...input(repo),
    budget: { max_runtime_minutes: 20, max_cost_usd: 1 },
  });

  await until(() => store.get(task.id, "alice").status === "completed");
  const failed = store.get(task.id, "alice");
  const turn = failed.turn;
  failed.status = "failed";
  failed.error = "Cost budget exhausted";
  failed.cost_usd = 0.8;
  store.save(failed);

  const updated = c.applyBudget("alice", task.id, { max_cost_usd: 2 });
  assert.equal(updated.status, "failed");
  assert.equal(updated.turn, turn);
  assert.equal(updated.budget.max_cost_usd, 2);

  assert.deepEqual(updated.budget_raised_for_turn, {
    turn,
    cost: true,
  });

  const persisted = store.get(task.id, "alice");
  assert.equal(persisted.budget.max_cost_usd, 2);

  assert.deepEqual(persisted.budget_raised_for_turn, {
    turn,
    cost: true,
  });

  await assert.rejects(
    Promise.resolve().then(() =>
      c.applyBudget("alice", task.id, { max_cost_usd: 1 }),
    ),
    /can only be raised/,
  );

  await c.close();
});

test("a mixed budget update only marks limits that increased", async () => {
  const { c, store, repo } = await setup();

  const task = await c.start("alice", {
    ...input(repo),
    budget: { max_runtime_minutes: 20, max_cost_usd: 1 },
  });

  await until(() => store.get(task.id, "alice").status === "completed");
  const failed = store.get(task.id, "alice");
  failed.status = "failed";
  failed.error = "Cost and runtime budget exhausted";
  failed.cost_usd = 0.8;
  store.save(failed);

  const updated = c.applyBudget("alice", task.id, {
    max_cost_usd: 1,
    max_runtime_minutes: 30,
  });

  assert.deepEqual(updated.budget_raised_for_turn, {
    turn: updated.turn,
    runtime: true,
  });

  await c.close();
});

test("cost counts each turn once, though a resumed session reports its running total", async () => {
  class Costly extends FixtureProvider {
    totals = [0.5, 0.8, 0.3];
    override async run(c: RunContext, p: string) {
      c.emit("agent.completed", { cost_usd: this.totals.shift() });

      return super.run(
        {
          ...c,
          emit: (type, data) => {
            if (type !== "agent.completed") c.emit(type, data);
          },
        },
        p,
      );
    }
  }

  const { c, store, repo } = await setup(new Costly());
  const t = await c.start("alice", input(repo));
  await until(() => store.get(t.id, "alice").status === "completed");
  await c.send("alice", t.id, "Again", "user");
  await until(() => store.get(t.id, "alice").turn === 2);
  await until(() => store.get(t.id, "alice").status === "completed");
  // 0.5, then 0.8 for the session so far: 0.3 more.
  assert.equal(store.get(t.id, "alice").cost_usd, 0.8);

  // A lower total started counting again, so all of it is new.
  await c.send("alice", t.id, "Again", "user");
  await until(() => store.get(t.id, "alice").turn === 3);
  await until(() => store.get(t.id, "alice").status === "completed");
  assert.ok(Math.abs(store.get(t.id, "alice").cost_usd! - 1.1) < 1e-9);
  await c.close();
});

/** A task's events of one type, as [type, data] pairs or just their data. */
function eventData(store: Store, id: string, type: string) {
  return store
    .events(id, "alice")
    .filter((e) => e.type === type)
    .map((e) => e.data);
}

/** The prompt each turn of a task started with. */
class PromptRecorder extends FixtureProvider {
  prompts: string[] = [];
  override async run(c: RunContext, p: string) {
    this.prompts.push(p);

    return super.run(c, p);
  }
}

test("a steer reaches the running turn at its next step without interrupting it", async () => {
  const { c, store, repo } = await setup();
  const t = await c.start("alice", input(repo, "[slow]"));
  await until(() => store.get(t.id, "alice").status === "running");
  const sent = await c.send("alice", t.id, "Mind the edge cases", "user");
  assert.equal(sent.state, "pending_steer");

  assert.deepEqual(
    store.get(t.id, "alice").pending_steers.map((m) => m.message),
    ["Mind the edge cases"],
  );

  await until(() => store.get(t.id, "alice").status === "completed");
  const done = store.get(t.id, "alice");
  assert.equal(done.turn, 1);
  assert.deepEqual(done.pending_steers, []);

  assert.deepEqual(
    done.instructions.map((m) => m.message),
    ["Mind the edge cases"],
  );

  assert.equal(done.instructions_sent, 1);

  assert.deepEqual(eventData(store, t.id, "task.steer_taken"), [
    { message_id: sent.message_id },
  ]);

  assert.match(
    String(store.latestEvent(t.id, "agent.reply")!.data.text),
    /Also took: Mind the edge cases/,
  );

  assert.deepEqual(eventData(store, t.id, "task.turn_ended").length, 1);
  await c.close();
});

test("a queued message waits for its own turn, which follows at once", async () => {
  const recorder = new PromptRecorder();
  const { c, store, repo } = await setup(recorder);
  const t = await c.start("alice", input(repo, "[slow]"));
  await until(() => store.get(t.id, "alice").status === "running");

  const sent = await c.send("alice", t.id, "Then write the docs", "parent", {
    delivery: "queue",
  });

  assert.equal(sent.state, "queued");
  // Queued messages have no event until their turn starts.
  assert.deepEqual(eventData(store, t.id, "task.instruction"), []);

  assert.deepEqual(eventData(store, t.id, "task.queue_changed"), [
    {
      queue: [
        {
          message_id: sent.message_id,
          message: "Then write the docs",
          from: "parent",
        },
      ],
      paused: false,
    },
  ]);

  await until(() => store.get(t.id, "alice").turn === 2);
  await until(() => store.get(t.id, "alice").status === "completed");
  assert.deepEqual(recorder.prompts.slice(1), ["Then write the docs"]);

  // The task never showed as completed between the turns.
  const types = store
    .events(t.id, "alice")
    .map((e) => e.type)
    .filter((type) =>
      ["task.turn_ended", "task.completed", "task.started"].includes(type),
    );

  assert.deepEqual(types, [
    "task.started",
    "task.turn_ended",
    "task.started",
    "task.turn_ended",
    "task.completed",
  ]);

  assert.deepEqual(
    eventData(store, t.id, "task.turn_ended").map((d) => [d.turn, d.outcome]),
    [
      [1, "completed"],
      [2, "completed"],
    ],
  );

  assert.deepEqual(eventData(store, t.id, "task.instruction"), [
    {
      message_id: sent.message_id,
      message: "Then write the docs",
      from: "parent",
      delivery: "queue",
    },
  ]);

  // On an idle task, a queued message starts the next turn.
  const idle = await c.send("alice", t.id, "Last bit", "user", {
    delivery: "queue",
  });

  assert.equal(idle.state, "started");
  await until(() => store.get(t.id, "alice").turn === 3);
  await c.close();
});

test("a steer the turn ends without taking starts the next turn from the front of the queue", async () => {
  const recorder = new PromptRecorder();
  const { c, store, repo } = await setup(recorder);
  const t = await c.start("alice", input(repo, "[late]"));
  await until(() => store.get(t.id, "alice").status === "running");
  const steer = await c.send("alice", t.id, "Late thought", "user");
  assert.equal(steer.state, "pending_steer");

  const queued = await c.send("alice", t.id, "Afterwards", "user", {
    delivery: "queue",
  });

  await until(() => store.get(t.id, "alice").turn === 3);
  await until(() => store.get(t.id, "alice").status === "completed");
  assert.deepEqual(recorder.prompts.slice(1), ["Late thought", "Afterwards"]);
  // The steer was recorded once, when it was sent.

  assert.deepEqual(
    eventData(store, t.id, "task.instruction").map((d) => [
      d.message_id,
      d.delivery,
    ]),
    [
      [steer.message_id, "steer"],
      [queued.message_id, "queue"],
    ],
  );

  assert.deepEqual(eventData(store, t.id, "task.steer_taken"), []);
  await c.close();
});

test("an interrupt with pending steers sends them at once as one new turn", async () => {
  const recorder = new PromptRecorder();
  const { c, store, repo } = await setup(recorder);
  const t = await c.start("alice", input(repo, "[late]"));
  await until(() => store.get(t.id, "alice").status === "running");
  await c.send("alice", t.id, "First thought", "user");
  await c.send("alice", t.id, "Later", "user", { delivery: "queue" });

  const sent = await c.send("alice", t.id, "Stop and do this", "parent", {
    delivery: "interrupt",
  });

  assert.equal(sent.state, "started");
  await until(() => store.get(t.id, "alice").turn === 3);
  await until(() => store.get(t.id, "alice").status === "completed");

  assert.deepEqual(recorder.prompts.slice(1), [
    "First thought\n\nStop and do this",
    "Later",
  ]);

  assert.deepEqual(
    eventData(store, t.id, "task.turn_ended").map((d) => d.outcome),
    ["interrupted", "completed", "completed"],
  );

  assert.equal(store.get(t.id, "alice").queue_paused, undefined);
  await c.close();
});

test("a plain interrupt pauses the queue, keeping pending steers at its front, until resumed or a message is sent", async () => {
  const recorder = new PromptRecorder();
  const { c, store, repo } = await setup(recorder);
  const t = await c.start("alice", input(repo, "[late]"));
  await until(() => store.get(t.id, "alice").status === "running");
  await c.send("alice", t.id, "Pending", "user");
  await c.send("alice", t.id, "Queued", "user", { delivery: "queue" });
  await c.interrupt("alice", t.id);
  const paused = store.get(t.id, "alice");
  assert.equal(paused.status, "interrupted");
  assert.equal(paused.queue_paused, true);

  assert.deepEqual(
    paused.queue.map((m) => m.message),
    ["Pending", "Queued"],
  );

  assert.deepEqual(eventData(store, t.id, "task.queue_changed").at(-1), {
    queue: paused.queue.map((m) => ({
      message_id: m.id,
      message: m.message,
      from: "user",
    })),
    paused: true,
  });

  // The next message sent resumes the queue, which follows it.
  await c.send("alice", t.id, "New idea", "user");
  await until(() => store.get(t.id, "alice").turn === 4);
  await until(() => store.get(t.id, "alice").status === "completed");

  assert.deepEqual(recorder.prompts.slice(1), [
    "New idea",
    "Pending",
    "Queued",
  ]);

  // Resume starts the next queued message on an idle task.
  await c.send("alice", t.id, "[late] once more", "user");
  await until(() => store.get(t.id, "alice").status === "running");
  await c.send("alice", t.id, "Kept", "user", { delivery: "queue" });
  await c.interrupt("alice", t.id);
  assert.equal(store.get(t.id, "alice").queue_paused, true);
  c.resumeQueue("alice", t.id);
  await until(() => store.get(t.id, "alice").turn === 6);
  await until(() => store.get(t.id, "alice").status === "completed");
  assert.equal(recorder.prompts.at(-1), "Kept");
  await c.close();
});

test("queued messages can be reordered behind the steers the worker already has", async () => {
  const recorder = new PromptRecorder();
  const { c, store, repo } = await setup(recorder);
  const t = await c.start("alice", input(repo, "[late]"));
  await until(() => store.get(t.id, "alice").status === "running");
  await c.send("alice", t.id, "Pending", "user");

  const [a, , last] = [
    await c.send("alice", t.id, "A", "user", { delivery: "queue" }),
    await c.send("alice", t.id, "B", "user", { delivery: "queue" }),
    await c.send("alice", t.id, "C", "user", { delivery: "queue" }),
  ];

  await c.interrupt("alice", t.id);
  const order = () => store.get(t.id, "alice").queue.map((m) => m.message);
  assert.deepEqual(order(), ["Pending", "A", "B", "C"]);

  // Nothing moves ahead of the left-over steer, and indexes clamp.
  c.moveQueued("alice", t.id, last.message_id, 0);
  assert.deepEqual(order(), ["Pending", "C", "A", "B"]);
  c.moveQueued("alice", t.id, a.message_id, 99);
  assert.deepEqual(order(), ["Pending", "C", "B", "A"]);

  const changed = eventData(store, t.id, "task.queue_changed").at(-1) as {
    queue: { message: string }[];
  };

  assert.deepEqual(
    changed.queue.map((m) => m.message),
    ["Pending", "C", "B", "A"],
  );

  const [pending] = store.get(t.id, "alice").queue;
  assert.ok(pending);

  assert.throws(
    () => c.moveQueued("alice", t.id, pending.id, 2),
    /stays at the front/,
  );

  assert.throws(
    () => c.moveQueued("alice", t.id, "msg_gone", 0),
    /no longer queued/,
  );

  c.resumeQueue("alice", t.id);
  await until(() => store.get(t.id, "alice").turn === 5);
  await until(() => store.get(t.id, "alice").status === "completed");
  assert.deepEqual(recorder.prompts.slice(1), ["Pending", "C", "B", "A"]);
  await c.close();
});

test("queued messages can be edited and removed until sent; the parent removes only its own", async () => {
  const recorder = new PromptRecorder();
  const { c, store, repo } = await setup(recorder);
  const t = await c.start("alice", input(repo, "[input]"));
  await until(() => !!store.get(t.id, "alice").pending_input);

  const mine = await c.send("alice", t.id, "Draft", "user", {
    delivery: "queue",
  });

  const theirs = await c.send("alice", t.id, "Parent note", "parent", {
    delivery: "queue",
  });

  const extra = await c.send("alice", t.id, "Extra", "user", {
    delivery: "queue",
  });

  assert.throws(
    () => c.removeQueued("alice", t.id, mine.message_id, "parent"),
    /only messages it queued/,
  );

  c.editQueued("alice", t.id, mine.message_id, "Final text");
  c.removeQueued("alice", t.id, theirs.message_id, "parent");
  c.removeQueued("alice", t.id, extra.message_id, "user");

  assert.deepEqual(eventData(store, t.id, "task.message_removed"), [
    { message_id: theirs.message_id },
    { message_id: extra.message_id },
  ]);

  const request = store.get(t.id, "alice").pending_input!;
  c.input("alice", t.id, request.id, true, { answer: "go" });
  await until(() => store.get(t.id, "alice").turn === 2);
  await until(() => store.get(t.id, "alice").status === "completed");
  assert.deepEqual(recorder.prompts.slice(1), ["Final text"]);

  assert.throws(
    () => c.removeQueued("alice", t.id, mine.message_id, "user"),
    /no longer queued/,
  );

  // Clear removes them all.
  const busy = await c.start("alice", input(repo, "[input]"));
  await until(() => !!store.get(busy.id, "alice").pending_input);
  await c.send("alice", busy.id, "One", "user", { delivery: "queue" });
  await c.send("alice", busy.id, "Two", "parent", { delivery: "queue" });
  c.clearQueue("alice", busy.id);
  assert.deepEqual(store.get(busy.id, "alice").queue, []);
  assert.equal(eventData(store, busy.id, "task.message_removed").length, 2);
  await c.close();
});

test("a worker waiting for input takes queued messages but no steers", async () => {
  const { c, store, repo } = await setup();
  const t = await c.start("alice", input(repo, "[input]"));
  await until(() => !!store.get(t.id, "alice").pending_input);

  await assert.rejects(
    c.send("alice", t.id, "Steer", "parent"),
    /waiting for input/,
  );

  const queued = await c.send("alice", t.id, "Queue", "parent", {
    delivery: "queue",
  });

  assert.equal(queued.state, "queued");
  assert.deepEqual(store.get(t.id, "alice").pending_steers, []);
  await c.close();
});

test("a restart mid-turn moves pending steers to the front of a paused queue", async () => {
  const { c, store, repo } = await setup();
  c.stopped = true;

  try {
    const t = await c.start("alice", input(repo));
    t.status = "running";
    t.turn = 1;

    t.pending_steers = [
      { id: "msg_pending", message: "Lost in the SDK", from: "user" },
    ];

    t.queue = [
      {
        id: "msg_queued",
        message: "Queued",
        from: "parent",
        delivery: "queue",
      },
    ];

    store.save(t);
    await c.recover();
    const recovered = store.get(t.id, "alice");
    assert.equal(recovered.status, "interrupted");
    assert.equal(recovered.queue_paused, true);
    assert.deepEqual(recovered.pending_steers, []);

    assert.deepEqual(
      recovered.queue.map((m) => [m.id, m.recorded ?? false]),
      [
        ["msg_pending", true],
        ["msg_queued", false],
      ],
    );

    assert.deepEqual(eventData(store, t.id, "task.queue_changed").at(-1), {
      queue: [
        { message_id: "msg_pending", message: "Lost in the SDK", from: "user" },
        { message_id: "msg_queued", message: "Queued", from: "parent" },
      ],
      paused: true,
    });
  } finally {
    await c.close();
  }
});

test("runtime budget stops a worker waiting for input", async () => {
  const { c, store, repo } = await setup();

  const t = await c.start("alice", {
    ...input(repo, "[input]"),
    budget: { max_runtime_minutes: 0.002, max_cost_usd: 1 },
  });

  await until(() => store.get(t.id, "alice").status === "failed");
  assert.match(store.get(t.id, "alice").error!, /Runtime budget/);
  await c.close();
});

test("unsupported budgets and providers fail before starting work", async () => {
  const { c, repo } = await setup();

  await assert.rejects(
    c.start("alice", { ...input(repo), budget: { max_tokens: 100 } }),
    /token budgets/,
  );

  await assert.rejects(
    c.start("alice", {
      provider: "claude",
      title: "test",
      repository: repo,
      description: "test",
    }),
    /not enabled/,
  );

  await c.close();
});

test("restart recovery marks live task interrupted and clears stale permissions", async () => {
  const { c, store, repo } = await setup();
  const t = await c.start("alice", input(repo, "[input]"));
  await until(() => !!store.get(t.id, "alice").pending_input);
  await c.interrupt("alice", t.id);
  const old = store.get(t.id, "alice");
  old.status = "waiting";
  old.waiting_reason = "waiting_for_permission";

  old.pending_input = {
    id: "old",
    kind: "permission",
    tool: "Bash",
    input: { command: "pwd" },
  };

  store.save(old);
  await c.recover();
  assert.equal(store.get(t.id, "alice").status, "interrupted");
  assert.equal(store.get(t.id, "alice").pending_input, undefined);
  await c.close();
});

test("workspace root allowlist rejects external repositories", async () => {
  const { c, dir, repo } = await setup();

  await assert.rejects(
    c.start("alice", { ...input(repo), repository: dir }),
    /outside allowed roots/,
  );

  await c.close();
});

test("worktree diff includes edits, untracked files and committed changes without touching primary checkout", async () => {
  class Writer extends FixtureProvider {
    override async run(c: RunContext, p: string) {
      await writeFile(join(c.task.workspace!, "README.md"), "changed\n");

      await writeFile(
        join(c.task.workspace!, "new.ts"),
        "export const answer = 42;\n",
      );

      execFileSync("git", ["-C", c.task.workspace!, "add", "README.md"]);

      execFileSync("git", [
        "-C",
        c.task.workspace!,
        "commit",
        "-qm",
        "worker edit",
      ]);

      return super.run(c, p);
    }
  }

  const { c, store, repo } = await setup(new Writer());
  const t = await c.start("alice", input(repo));

  await until(
    () =>
      !c.active.has(t.id) && store.get(t.id, "alice").status === "completed",
  );

  // The worktree is on the task's own branch, which holds the worker's commit.
  const done = store.get(t.id, "alice");
  assert.equal(done.branch, `agent/${t.id}`);

  assert.equal(
    execFileSync("git", ["-C", repo, "log", "-1", "--format=%s", done.branch])
      .toString()
      .trim(),
    "worker edit",
  );

  assert.equal(
    execFileSync("git", ["-C", done.workspace!, "branch", "--show-current"])
      .toString()
      .trim(),
    done.branch,
  );

  const { diff, files } = await c.workspaces.changes(done);

  assert.deepEqual(
    files.map((file) => [file.path, file.status]),
    [
      ["README.md", "modified"],
      ["new.ts", "added"],
    ],
  );

  assert.match(diff, /changed/);
  assert.match(diff, /answer = 42/);
  execFileSync("git", ["-C", repo, "apply", "--check", "-"], { input: diff });

  assert.equal(await readFile(join(repo, "README.md"), "utf8"), "hello\n");
  await c.close();
});

test("worktree branches use the owner's prefix, and Git rejects invalid names", async () => {
  const { c, store, repo } = await setup();

  try {
    assert.throws(() =>
      c.settings.update("alice", { set: { worktree_branch_prefix: "a b/" } }),
    );

    c.settings.update("alice", { set: { worktree_branch_prefix: "work/" } });
    const t = await c.start("alice", input(repo));
    await until(() => store.get(t.id, "alice").status === "completed");
    assert.equal(store.get(t.id, "alice").branch, `work/${t.id}`);

    execFileSync("git", [
      "-C",
      repo,
      "rev-parse",
      "--verify",
      `refs/heads/work/${t.id}`,
    ]);

    // Allowed characters can still form an invalid ref.
    c.settings.update("alice", { set: { worktree_branch_prefix: "a..b/" } });
    const bad = await c.start("alice", input(repo));
    await until(() => store.get(bad.id, "alice").status === "failed");
    assert.match(store.get(bad.id, "alice").error!, /Invalid worktree branch/);
    assert.equal(store.get(bad.id, "alice").workspace, undefined);
  } finally {
    await c.close();
  }
});

test("a stopped task's worktree is removed, keeping the branch, then the branch can be deleted", async () => {
  const { c, store, repo } = await setup();

  const branches = () =>
    execFileSync("git", ["-C", repo, "branch", "--list", "agent/*"])
      .toString()
      .trim();

  const pins = () =>
    execFileSync("git", ["-C", repo, "for-each-ref", "refs/agent-tasks"])
      .toString()
      .trim();

  try {
    const running = await c.start("alice", input(repo, "[input]"));
    await until(() => !!store.get(running.id, "alice").pending_input);

    await assert.rejects(
      c.removeWorktree("alice", running.id),
      /Wait until the task stops/,
    );

    await c.interrupt("alice", running.id);
    const t = store.get(running.id, "alice");

    await assert.rejects(
      c.deleteBranch("alice", t.id),
      /Remove the worktree before deleting its branch/,
    );

    // Uncommitted work is listed, not discarded, until the user confirms.
    await writeFile(join(t.workspace!, "draft.txt"), "draft\n");

    assert.deepEqual(await c.removeWorktree("alice", t.id), {
      status: "uncommitted",
      files: ["draft.txt"],
    });

    assert.deepEqual(await c.removeWorktree("alice", t.id, true), {
      status: "removed",
    });

    assert.match(branches(), new RegExp(`agent/${t.id}`));
    assert.equal((await c.workspaces.changes(t)).state, "workspace_missing");
    assert.match(pins(), /turn-start/);

    await assert.rejects(c.removeWorktree("alice", t.id), /already removed/);

    assert.deepEqual(await c.deleteBranch("alice", t.id), {
      status: "deleted",
    });

    assert.equal(branches(), "");
    assert.equal((await c.workspaces.changes(t)).state, "branch_deleted");
    // Deleting the branch also unpins the task's snapshots.
    assert.equal(pins(), "");

    // Each outcome is a task event.
    assert.deepEqual(
      store
        .events(t.id, "alice")
        .filter(
          (e) =>
            e.type.startsWith("task.worktree") ||
            e.type.startsWith("task.branch"),
        )
        .map((e) => [e.type, e.data]),
      [
        [
          "task.worktree_removed",
          { path: t.workspace, branch: t.branch, forced: true },
        ],
        ["task.branch_deleted", { branch: t.branch }],
      ],
    );

    // Another user can't act on the task.
    await assert.rejects(c.removeWorktree("bob", t.id));

    // The next message recreates the worktree: from its branch, or from the
    // base commit once the branch is gone too.
    const paused = await c.start("alice", input(repo, "[input]"));
    await until(() => !!store.get(paused.id, "alice").pending_input);
    await c.interrupt("alice", paused.id);
    await c.removeWorktree("alice", paused.id);
    await c.send("alice", paused.id, "Carry on", "user");
    await until(() => store.get(paused.id, "alice").status === "completed");
    assert.ok(existsSync(store.get(paused.id, "alice").workspace!));
    await c.removeWorktree("alice", paused.id);
    await c.deleteBranch("alice", paused.id);
    await c.send("alice", paused.id, "Once more", "user");
    await until(() => store.get(paused.id, "alice").turn === 3);
    await until(() => store.get(paused.id, "alice").status === "completed");
    const recreated = store.get(paused.id, "alice");
    assert.match(branches(), new RegExp(`agent/${paused.id}`));

    assert.equal(
      execFileSync("git", ["-C", recreated.workspace!, "rev-parse", "HEAD"])
        .toString()
        .trim(),
      recreated.base_commit,
    );

    assert.deepEqual(
      store
        .events(paused.id, "alice")
        .filter((e) => e.type === "task.worktree_recreated")
        .map((e) => e.data),
      [{ from: "branch" }, { from: "base" }],
    );
  } finally {
    await c.close();
  }
});

test("a task is deleted in any state with everything related to it", async () => {
  const { c, store, repo } = await setup();

  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args])
      .toString()
      .trim();

  const sessions: string[] = [];

  c.providers.get("fixture")!.deleteSession = async (t) => {
    sessions.push(t.id);
  };

  try {
    const t = await c.start("alice", input(repo, "[input]"));
    await until(() => !!store.get(t.id, "alice").pending_input);
    const stopped = store.get(t.id, "alice");
    assert.ok(stopped.workspace && existsSync(stopped.workspace));
    assert.match(git("branch", "--list", "agent/*"), new RegExp(t.id));
    assert.match(git("for-each-ref", "refs/agent-tasks"), /turn-start/);

    // A task that depends on this one keeps it, whatever its state, since a
    // follow-up could still resume it.
    const dependent = await c.start("alice", {
      ...input(repo, "[input]"),
      depends_on: [t.id],
    });

    await until(() => store.get(dependent.id, "alice").status === "waiting");
    await c.interrupt("alice", dependent.id);

    await assert.rejects(
      c.delete("alice", t.id),
      new RegExp(`${dependent.id} depends on this task`),
    );

    await c.delete("alice", dependent.id);
    await assert.rejects(c.delete("bob", t.id), /not found/);
    assert.deepEqual(sessions, []);

    // One waiting for input is interrupted first.
    assert.deepEqual(await c.delete("alice", t.id, true), {
      status: "deleted",
    });

    assert.equal(c.active.has(t.id), false);

    assert.deepEqual(sessions, [t.id]);
    assert.throws(() => store.get(t.id, "alice"), /Task not found/);

    assert.deepEqual(store.taskEvents(t.id, 0), []);

    assert.equal(existsSync(stopped.workspace), false);
    assert.equal(git("branch", "--list", "agent/*").includes(t.id), false);
    assert.equal(git("for-each-ref", "refs/agent-tasks").includes(t.id), false);

    // Without the option, the provider's session is left alone.
    const kept = await c.start("alice", input(repo, "[input]"));
    await until(() => !!store.get(kept.id, "alice").pending_input);
    await c.interrupt("alice", kept.id);
    await c.delete("alice", kept.id);
    assert.deepEqual(sessions, [t.id]);
  } finally {
    await c.close();
  }
});

test("scheduler enforces concurrency and independent branches run together", async () => {
  const { c, store, repo } = await setup(undefined, 2);

  const tasks = await Promise.all([
    c.start("alice", input(repo, "[input]")),
    c.start("alice", input(repo, "[input]")),
    c.start("alice", input(repo, "[input]")),
  ]);

  await until(
    () =>
      c.active.size === 2 &&
      tasks.filter((t) => !!store.get(t.id, "alice").pending_input).length ===
        2,
  );

  assert.equal(
    tasks.filter((t) => store.get(t.id, "alice").status === "queued").length,
    1,
  );

  await c.interrupt("alice", tasks[0].id);
  await until(() => !!store.get(tasks[2].id, "alice").pending_input);
  await c.close();
});

test("parallel permission requests are serialized without losing the first response", async () => {
  class Parallel extends FixtureProvider {
    override async run(c: RunContext, _prompt: string): Promise<TurnOutput> {
      const [first, second] = await Promise.all([
        c.input("Bash", { command: "first" }, c.signal),
        c.input("Bash", { command: "second" }, c.signal),
      ]);

      return {
        reply: JSON.stringify([first.approved, second.approved]),
      };
    }
  }

  const { c, store, repo } = await setup(new Parallel());
  const t = await c.start("alice", input(repo));
  await until(() => !!store.get(t.id, "alice").pending_input);
  let request = store.get(t.id, "alice").pending_input!;
  assert.equal(request.input.command, "first");
  c.input("alice", t.id, request.id, true);

  await until(
    () => store.get(t.id, "alice").pending_input?.input.command === "second",
  );

  request = store.get(t.id, "alice").pending_input!;
  c.input("alice", t.id, request.id, false);
  await until(() => store.get(t.id, "alice").status === "completed");

  assert.equal(
    store.latestEvent(t.id, "agent.reply")?.data.text,
    "[true,false]",
  );

  await c.close();
});

test("unsupported cost limits fail before task persistence and explicit null allows execution", async () => {
  const provider = new FixtureProvider();
  provider.capabilities.cost_budget = false;
  const { c, repo } = await setup(provider);

  try {
    await assert.rejects(
      c.start("alice", {
        ...input(repo),
        budget: { max_runtime_minutes: null, max_cost_usd: 1 },
      }),
      /does not support cost budgets/,
    );

    assert.equal(c.store.all().length, 0);

    const task = await c.start("alice", {
      ...input(repo),
      budget: { max_cost_usd: null },
    });

    assert.equal(task.budget.max_cost_usd, null);
    await until(() => c.store.get(task.id, "alice").status === "completed");
    assert.equal(c.store.get(task.id, "alice").budget.max_cost_usd, null);
  } finally {
    await c.close();
  }
});

test("no cost limit persists in settings and explicit task limits override it", async () => {
  const { c, db, repo } = await setup();
  c.settings.update("alice", { set: { max_cost_usd: null } });
  const task = await c.start("alice", input(repo));
  assert.equal(task.budget.max_cost_usd, null);

  const limited = await c.start("alice", {
    ...input(repo),
    budget: { max_cost_usd: 2 },
  });

  assert.equal(limited.budget.max_cost_usd, 2);
  assert.equal(c.settings.values("bob").max_cost_usd, null);
  await c.close();
  const store = new Store(db);
  const { Settings } = await import("../../settings/settings.js");

  assert.equal(
    new Settings(store.database, () => ["fixture"]).values("alice")
      .max_cost_usd,
    null,
  );

  store.close();
});

test("a follow-up revalidates provider budget support before changing an interrupted task", async () => {
  const provider = new FixtureProvider();
  const { c, repo } = await setup(provider);
  c.stopped = true;

  try {
    const task = await c.start("alice", {
      ...input(repo),
      budget: { max_runtime_minutes: null, max_cost_usd: 1 },
    });

    await c.interrupt("alice", task.id);
    provider.capabilities.cost_budget = false;

    await assert.rejects(
      c.send("alice", task.id, "Continue", "user"),
      /does not support cost budgets/,
    );

    assert.equal(c.store.get(task.id, "alice").status, "interrupted");
  } finally {
    await c.close();
  }
});

test("cancelled queued input rejects promptly without bypassing the active permission or leaving stale requests", async () => {
  const cancelled = new AbortController();
  let queuedRejected = false;
  let firstApproved = false;
  const provider = new FixtureProvider();

  provider.run = async (ctx) => {
    const first = ctx.input("Bash", { command: "first" }, ctx.signal);

    const queued = ctx.input(
      "Bash",
      { command: "cancelled" },
      cancelled.signal,
    );

    const third = ctx.input("Bash", { command: "third" }, ctx.signal);
    cancelled.abort();
    await assert.rejects(queued, /Input interrupted/);
    queuedRejected = true;
    firstApproved = (await first).approved;
    await third;
    const alreadyAborted = new AbortController();
    alreadyAborted.abort();

    await assert.rejects(
      ctx.input("Bash", { command: "already aborted" }, alreadyAborted.signal),
      /Input interrupted/,
    );

    return {
      reply: "Cancelled inputs skipped",
    };
  };

  const { c, store, repo } = await setup(provider);

  try {
    const task = await c.start("alice", input(repo));

    await until(
      () => queuedRejected && !!store.get(task.id, "alice").pending_input,
    );

    const first = store.get(task.id, "alice").pending_input!;
    assert.equal(first.input.command, "first");
    assert.equal(firstApproved, false);
    c.input("alice", task.id, first.id, true);

    await until(
      () =>
        store.get(task.id, "alice").pending_input?.input.command === "third",
    );

    assert.throws(() => c.input("alice", task.id, first.id, true), /stale/);

    c.input(
      "alice",
      task.id,
      store.get(task.id, "alice").pending_input!.id,
      false,
    );

    await until(() => store.get(task.id, "alice").status === "completed");
    assert.equal(firstApproved, true);
    assert.equal(store.get(task.id, "alice").pending_input, undefined);

    assert.deepEqual(
      store
        .events(task.id, "alice")
        .filter((e) => e.type === "agent.input_required")
        .map((e) => (e.data.request as any).input.command),
      ["first", "third"],
    );
  } finally {
    await c.close();
  }
});

test("deletion locks execution, dependencies and duplicate cleanup until it finishes", async () => {
  const { c, store, repo } = await setup();
  let release!: () => void;

  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });

  let deleting = false;

  c.providers.get("fixture")!.deleteSession = async () => {
    deleting = true;
    await pending;
  };

  try {
    const task = await c.start("alice", input(repo, "[input]"));
    await until(() => !!store.get(task.id, "alice").pending_input);
    await c.interrupt("alice", task.id);
    const deletion = c.delete("alice", task.id, true);
    await until(() => deleting);

    await assert.rejects(
      c.send("alice", task.id, "Resume", "user"),
      /being deleted/,
    );

    await assert.rejects(
      c.send("alice", task.id, "Resume", "user", { delivery: "queue" }),
      /being deleted/,
    );

    await assert.rejects(c.interrupt("alice", task.id), /being deleted/);

    await assert.rejects(c.delete("alice", task.id), /being deleted/);

    await assert.rejects(
      c.start("alice", { ...input(repo), depends_on: [task.id] }),
      /being deleted/,
    );

    release();
    await deletion;
    assert.throws(() => store.get(task.id, "alice"), /not found/);
  } finally {
    release?.();
    await c.close();
  }
});

test("provider deletion failures preserve local task resources and release the lock", async () => {
  const { c, store, repo } = await setup();

  c.providers.get("fixture")!.deleteSession = async () => {
    throw new Error("cleanup failed");
  };

  try {
    const task = await c.start("alice", input(repo, "[input]"));
    await until(() => !!store.get(task.id, "alice").pending_input);
    await c.interrupt("alice", task.id);
    await assert.rejects(c.delete("alice", task.id, true), /cleanup failed/);
    const kept = store.get(task.id, "alice");
    assert.equal(existsSync(kept.workspace!), true);
    assert.ok(store.events(task.id, "alice").length);
    await c.delete("alice", task.id);
    assert.throws(() => store.get(task.id, "alice"), /not found/);
  } finally {
    await c.close();
  }
});

test("a follow-up already awaiting project validation cannot resurrect a deleted task", async () => {
  const { c, store, repo } = await setup();
  let release!: () => void;

  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });

  let validating = false;

  try {
    const task = await c.start("alice", input(repo, "[input]"));
    await until(() => !!store.get(task.id, "alice").pending_input);
    await c.interrupt("alice", task.id);

    c.projects = {
      resolve: async () => {
        validating = true;
        await pending;
      },
    } as unknown as typeof c.projects;

    const continuation = c.send("alice", task.id, "Continue", "user");
    // Attach the rejection assertion before cleanup can make filesystem checks fail.
    const rejected = assert.rejects(continuation, /not found|removed|ENOENT/);
    await until(() => validating);
    await c.delete("alice", task.id);
    release();
    await rejected;
    assert.throws(() => store.get(task.id, "alice"), /not found/);
  } finally {
    release?.();
    await c.close();
  }
});

test("a new provider controls preparation and input policy without built-in identity assumptions", async () => {
  const provider: Provider = new FixtureProvider();
  provider.id = "new-built-in";
  const prepared: string[] = [];
  const decisions: boolean[] = [];
  let allowParent = false;

  provider.taskPolicy = {
    prepareStart({ input, authority }) {
      assert.equal(input.approval_mode, undefined);

      if (input.model === "forbidden") {
        throw new Error("Native model unavailable");
      }

      const options = input.provider_options?.[input.provider];

      if (
        options?.execution_pool !== undefined &&
        options.execution_pool !== "isolated"
      ) {
        throw new Error("Native execution pool must be isolated");
      }

      prepared.push(authority);

      return {
        model: "native-default",
        reasoning_effort: "minimal",
        provider_options: {
          [input.provider]: { execution_pool: "isolated" },
        },
      };
    },
    decideInput: () => true,
    parentMayApprove: () => allowParent,
    inputKind: (tool) =>
      tool === "ChooseApproach" ? "question" : "permission",
  };

  provider.run = async (context) => {
    const automatic = await context.input("NativeRead", {}, context.signal);
    decisions.push(automatic.approved);
    await context.input("ChooseApproach", {}, context.signal);
    // Changing the provider's automatic policy affects its next request.
    provider.taskPolicy.decideInput = () => undefined;
    const manual = await context.input("NativeWrite", {}, context.signal);
    decisions.push(manual.approved);

    return {
      reply: "Done",
    };
  };

  const { c, store, repo } = await setup(provider);

  try {
    await assert.rejects(
      c.start("alice", {
        ...input(repo),
        provider: provider.id,
        model: "forbidden",
      }),
      /Native model unavailable/,
    );

    await assert.rejects(
      c.start("alice", {
        ...input(repo),
        provider: provider.id,
        provider_options: {
          [provider.id]: { execution_pool: "shared" },
        },
      }),
      /must be isolated/,
    );

    await assert.rejects(
      c.start("alice", {
        ...input(repo),
        provider: provider.id,
        provider_options: { claude: { permission_mode: "plan" } },
      }),
      /selected provider/,
    );

    assert.equal(store.all().length, 0);

    const task = await c.start(
      "alice",
      { ...input(repo), provider: provider.id },
      "parent",
    );

    assert.equal(task.model, "native-default");
    assert.equal(task.reasoning_effort, "minimal");

    assert.deepEqual(task.provider_options, {
      [provider.id]: { execution_pool: "isolated" },
    });

    assert.deepEqual(
      store.get(task.id, "alice").provider_options,
      task.provider_options,
    );

    assert.deepEqual(prepared, ["parent"]);

    await until(
      () =>
        store.get(task.id, "alice").pending_input?.tool === "ChooseApproach",
    );

    const question = store.get(task.id, "alice").pending_input!;
    assert.equal(question.kind, "question");
    assert.deepEqual(decisions, [true]);

    // Questions remain interactive even when the native policy approves tools.
    c.input(
      "alice",
      task.id,
      question.id,
      true,
      { choice: "small" },
      undefined,
      "parent",
    );

    await until(
      () => store.get(task.id, "alice").pending_input?.tool === "NativeWrite",
    );

    const permission = store.get(task.id, "alice").pending_input!;

    assert.throws(
      () =>
        c.input(
          "alice",
          task.id,
          permission.id,
          true,
          undefined,
          undefined,
          "parent",
        ),
      /requires user approval/,
    );

    allowParent = true;

    c.input(
      "alice",
      task.id,
      permission.id,
      false,
      undefined,
      undefined,
      "parent",
    );

    await until(() => store.get(task.id, "alice").status === "completed");
    assert.deepEqual(decisions, [true, false]);
  } finally {
    await c.close();
  }
});

test("a new provider owns native session continuation after a restart", async () => {
  const provider: Provider = new FixtureProvider();
  provider.id = "new-native";
  let sessionValid = false;
  const validated: string[] = [];

  const policy: ProviderTaskPolicy = {
    prepareStart: () => ({}),
    decideInput: () => undefined,
    parentMayApprove: () => false,
    inputKind: () => "permission",
    async validateSession(task) {
      validated.push(task.session_state_ref!);
      if (!sessionValid) throw new Error("Native session unavailable");
    },
  };

  provider.taskPolicy = policy;
  const { c, store, repo } = await setup(provider);
  c.stopped = true;

  try {
    const task = await c.start("alice", {
      ...input(repo),
      provider: provider.id,
    });

    task.status = "running";
    task.turn = 1;

    task.provider_options = {
      ...task.provider_options,
      [provider.id]: { native_turn_id: "native-turn" },
    };

    task.session_id = "native-session";
    task.session_state_ref = "native:opaque-session";
    task.session_owner = c.ownerWorker;
    store.save(task);
    await c.recover();
    assert.equal(store.get(task.id, "alice").status, "interrupted");
    c.stopped = false;

    // A session the provider rejects gives way to a new one.
    await c.send("alice", task.id, "Continue", "user");
    await until(() => store.get(task.id, "alice").status === "completed");
    const renewed = store.get(task.id, "alice");

    assert.equal(
      renewed.provider_options?.[provider.id]?.native_turn_id,
      "native-turn",
    );

    assert.equal(renewed.session_id, `fixture_${task.id}`);

    assert.deepEqual(
      store
        .events(task.id, "alice")
        .filter((e) => e.type === "task.session_started")
        .map((e) => e.data),
      [{ reason: "session_unavailable" }],
    );

    // One it accepts resumes.
    sessionValid = true;
    await c.send("alice", task.id, "Continue", "user");
    await until(() => store.get(task.id, "alice").turn === 3);
    await until(() => store.get(task.id, "alice").status === "completed");
    assert.equal(store.get(task.id, "alice").session_id, `fixture_${task.id}`);

    assert.deepEqual(validated, [
      "native:opaque-session",
      `fixture:${renewed.workspace}`,
    ]);
  } finally {
    await c.close();
  }
});

test("user task renaming checks ownership and persists across active turn updates", async () => {
  const { c, store, repo } = await setup();
  const { callTool } = await import("../../../platform/server/tools.js");
  const task = await c.start("alice", input(repo, "[input]"));

  try {
    await until(() => store.get(task.id, "alice").status === "waiting");

    await assert.rejects(
      callTool(c, "alice", "rename_user_agent_task", {
        task_id: task.id,
        title: "New title",
      }),
      /User tools require a user interface/,
    );

    await assert.rejects(
      callTool(
        c,
        "bob",
        "rename_user_agent_task",
        {
          task_id: task.id,
          title: "New title",
        },
        "user",
      ),
      /Task not found/,
    );

    for (const title of ["   ", "x".repeat(201)]) {
      await assert.rejects(
        callTool(
          c,
          "alice",
          "rename_user_agent_task",
          {
            task_id: task.id,
            title,
          },
          "user",
        ),
      );
    }

    await callTool(
      c,
      "alice",
      "rename_user_agent_task",
      {
        task_id: task.id,
        title: "  New title  ",
      },
      "user",
    );

    assert.equal(store.get(task.id, "alice").title, "New title");
    assert.equal(c.active.get(task.id)?.task.title, "New title");
    await c.interrupt("alice", task.id);
    assert.equal(store.get(task.id, "alice").title, "New title");
    assert.equal(store.get(task.id, "alice").description, task.description);
  } finally {
    await c.close();
  }
});

test("a task whose first event can't be written is never created", async () => {
  const { store, c, repo } = await setup();

  try {
    const heard: string[] = [];
    store.bus.on("event", (e: { type: string }) => heard.push(e.type));

    store.database.client.exec(
      "CREATE TRIGGER reject_queued BEFORE INSERT ON events WHEN NEW.type='task.queued' BEGIN SELECT RAISE(ABORT, 'event write failed'); END",
    );

    await assert.rejects(c.start("local", input(repo)), /event write failed/);
    assert.deepEqual(store.all(), []);
    assert.deepEqual(heard, []);
  } finally {
    await c.close();
  }
});

test("completion reports wait for successful finalization while blockers persist immediately", async () => {
  const started = Promise.withResolvers<RunContext>();
  const finish = Promise.withResolvers<void>();
  const provider = new FixtureProvider();

  provider.run = async (context) => {
    started.resolve(context);
    await finish.promise;

    return { reply: "Done" };
  };

  const { c, store, repo } = await setup(provider);

  try {
    const task = await c.start("alice", {
      ...input(repo),
      conversation_id: "parent-chat",
    });

    const context = await started.promise;
    assert.equal(context.messageParent!("  Done  "), undefined);
    assert.deepEqual(eventData(store, task.id, "parent.message"), []);

    assert.throws(
      () => context.messageParent!("Duplicate", "completion"),
      /already has a parent completion report/,
    );

    const blocker = context.messageParent!("  Need attention  ", "blocker");
    assert.equal(typeof blocker, "number");

    assert.deepEqual(eventData(store, task.id, "parent.message"), [
      { text: "Need attention" },
    ]);

    finish.resolve();
    await until(() => !c.active.has(task.id));
    assert.equal(store.get(task.id, "alice").status, "completed");

    assert.deepEqual(eventData(store, task.id, "parent.message"), [
      { text: "Need attention" },
      { text: "Done" },
    ]);

    const events = store.events(task.id, "alice");

    const report = events
      .filter((event) => event.type === "parent.message")
      .at(-1)!;

    const completed = events.find((event) => event.type === "task.completed")!;
    assert.ok(report.id > completed.id);
  } finally {
    finish.resolve();
    await c.close();
  }
});

test.each(["failed", "interrupted"] as const)(
  "a %s turn discards its completion report and its follow-up gets a fresh report",
  async (outcome) => {
    const started = Promise.withResolvers<RunContext>();
    const finish = Promise.withResolvers<void>();
    const provider = new FixtureProvider();

    provider.run = async (context) => {
      if (context.task.turn === 1) {
        context.messageParent!("Discard this completion");
        context.messageParent!("Immediate blocker", "blocker");
        started.resolve(context);
        await finish.promise;

        if (outcome === "failed") {
          throw new Error("Provider failed after reporting");
        }

        return { reply: "Interrupted output" };
      }

      context.messageParent!("Follow-up completion");

      return { reply: "Follow-up done" };
    };

    const { c, store, repo } = await setup(provider);

    try {
      const task = await c.start("alice", {
        ...input(repo),
        conversation_id: "parent-chat",
      });

      const context = await started.promise;

      if (outcome === "interrupted") {
        const stopping = c.interrupt("alice", task.id);
        await until(() => context.signal.aborted);
        finish.resolve();
        await stopping;
      } else {
        finish.resolve();
      }

      await until(() => !c.active.has(task.id));
      assert.equal(store.get(task.id, "alice").status, outcome);

      assert.deepEqual(eventData(store, task.id, "parent.message"), [
        { text: "Immediate blocker" },
      ]);

      await c.send("alice", task.id, "Try again", "parent");

      await until(
        () => store.get(task.id, "alice").turn === 2 && !c.active.has(task.id),
      );

      assert.equal(store.get(task.id, "alice").status, "completed");

      assert.deepEqual(eventData(store, task.id, "parent.message"), [
        { text: "Immediate blocker" },
        { text: "Follow-up completion" },
      ]);
    } finally {
      finish.resolve();
      await c.close();
    }
  },
);

test("runtime budget expiring during reply snapshot discards the completion report", async () => {
  const started = Promise.withResolvers<RunContext>();
  const snapshotStarted = Promise.withResolvers<void>();
  const finishSnapshot = Promise.withResolvers<void>();
  const provider = new FixtureProvider();

  provider.run = async (context) => {
    context.messageParent!("Must not deliver");
    started.resolve(context);

    return { reply: "Provider returned before deadline" };
  };

  const { c, store, repo } = await setup(provider);
  const originalSnapshot = c.workspaces.snapshot.bind(c.workspaces);

  vi.spyOn(c.workspaces, "snapshot").mockImplementation(async (workspace) => {
    if (
      store
        .all("alice")
        .some((task) => task.status === "running" && task.turn === 1)
    ) {
      snapshotStarted.resolve();
      await finishSnapshot.promise;
    }

    return originalSnapshot(workspace);
  });

  try {
    const task = await c.start("alice", {
      ...input(repo),
      conversation_id: "parent-chat",
      budget: { max_runtime_minutes: 0.002, max_cost_usd: null },
    });

    const context = await started.promise;
    await snapshotStarted.promise;
    await until(() => context.signal.aborted);
    finishSnapshot.resolve();
    await until(() => !c.active.has(task.id));
    assert.equal(store.get(task.id, "alice").status, "failed");

    assert.match(
      store.get(task.id, "alice").error!,
      /Runtime budget exhausted/,
    );

    assert.deepEqual(eventData(store, task.id, "agent.reply"), []);
    assert.deepEqual(eventData(store, task.id, "parent.message"), []);
  } finally {
    finishSnapshot.resolve();
    await c.close();
    vi.restoreAllMocks();
  }
});
