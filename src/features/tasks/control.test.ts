import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test } from "vitest";

import { FixtureProvider } from "../../../dev/fixture-provider.js";
import type {
  ModelChoice,
  Provider,
  Result,
  RunContext,
} from "../../shared/contracts.js";
import { Workspaces } from "../workspaces/workspace.js";
import { Control } from "./control.js";
import { Store } from "./store.js";

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
    repo,
    concurrency,
  );

  return { dir, repo, db, store, c };
}

const input = (description = "Investigate") => ({
  provider: "fixture",
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
    const workers = await c.availableWorkers();
    assert.deepEqual((workers[0] as any).models, models);
    assert.equal(workers[0].provider, "fixture");

    provider.models = async () => {
      throw new Error("unavailable");
    };

    const fallback = (await c.availableWorkers())[0] as any;
    assert.equal(fallback.models, undefined);
    assert.match(fallback.model_discovery_error, /Model discovery unavailable/);
    assert.deepEqual(fallback.profiles, workers[0].profiles);
    assert.deepEqual(fallback.capabilities, workers[0].capabilities);
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

  const { c, store } = await setup(provider);

  try {
    await assert.rejects(
      c.start("alice", { ...input(), reasoning_effort: "high" }),
      /does not support reasoning effort high/,
    );

    assert.equal(store.all().length, 0);

    for (const model of ["no-effort", "limited-effort"]) {
      await assert.rejects(
        c.start("alice", { ...input(), model, reasoning_effort: "high" }),
        /does not support reasoning effort high/,
      );

      assert.equal(store.all().length, 0);
    }

    for (const model of ["unknown-effort", "custom-model"]) {
      const task = await c.start("alice", {
        ...input(),
        model,
        reasoning_effort: "high",
      });

      await until(() => store.get(task.id, "alice").status === "completed");
      assert.equal(task.model, model);
    }

    const supported = await c.start("alice", {
      ...input(),
      model: "limited-effort",
      reasoning_effort: "low",
    });

    await until(() => store.get(supported.id, "alice").status === "completed");

    provider.models = async () => {
      throw new Error("Discovery unavailable");
    };

    const unavailable = await c.start("alice", {
      ...input(),
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
  let calls = 0;
  const run = provider.run.bind(provider);

  provider.run = async (...args) => {
    calls++;

    return run(...args);
  };

  const { c, store } = await setup(provider);

  try {
    for (const reasoning_effort of ["none", "minimal"]) {
      await assert.rejects(
        c.start("alice", { ...input(), provider: "claude", reasoning_effort }),
        /Claude reasoning effort/,
      );

      c.settings.update("alice", {
        set: { default_reasoning_effort: reasoning_effort },
      });

      await assert.rejects(
        c.start("alice", { ...input(), provider: "claude" }),
        /Claude reasoning effort/,
      );

      assert.equal(store.all().length, 0);
      assert.equal(calls, 0);
    }

    const task = await c.start("alice", {
      ...input(),
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

test("task titles stay separate from trimmed worker instructions", async () => {
  const provider = new FixtureProvider();
  const original = provider.run.bind(provider);
  let received: string | undefined;

  provider.run = async (ctx, prompt) => {
    received = prompt;

    return original(ctx, prompt);
  };

  const { c, store } = await setup(provider);

  try {
    const task = await c.start("alice", {
      ...input(),
      title: "  Concise heading  ",
      description: "  Full instructions\nwith detailed evidence.  ",
    });

    await until(() => store.get(task.id, "alice").status === "completed");
    assert.equal(task.title, "Concise heading");

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

test("missing titles are generated while workers receive the full request", async () => {
  const provider = new FixtureProvider();
  const original = provider.run.bind(provider);
  let received: string | undefined;

  provider.run = async (ctx, prompt) => {
    received = prompt;

    return original(ctx, prompt);
  };

  const { c, store } = await setup(provider);

  try {
    const description =
      "Review authentication.\nInclude every edge case and report the evidence.";

    const task = await c.start("alice", {
      ...input(),
      title: undefined,
      description,
    });

    await until(() => store.get(task.id, "alice").status === "completed");
    assert.equal(task.title, "Review authentication.");
    assert.equal(task.description, description);
    assert.equal(received, description);
    assert.equal(store.get(task.id, "alice").title, task.title);
    assert.equal(store.get(task.id, "alice").description, description);
  } finally {
    await c.close();
  }
});

test("invalid title or description cannot persist or execute a task", async () => {
  const provider = new FixtureProvider();
  let runs = 0;

  provider.run = async () => {
    runs++;
    throw new Error("Unexpected execution");
  };

  const { c, store } = await setup(provider);

  try {
    const cases = [
      { description: undefined },
      { title: "" },
      { description: "" },
      { title: " \n\t " },
      { description: " \n\t " },
      { title: "x".repeat(121) },
      { description: "x".repeat(20001) },
    ];

    for (const invalid of cases) {
      await assert.rejects(c.start("alice", { ...input(), ...invalid }));
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
    set: { max_runtime_minutes: 8, default_worker_profile: "implementer" },
  });

  c.settings.update("alice", { set: { max_cost_usd: 2 } });
  assert.equal(c.settings.values("alice").max_runtime_minutes, 8);
  assert.equal(c.settings.values("bob").max_runtime_minutes, 20);
  const read = c.settings.read("alice");
  assert.equal(read.values.max_cost_usd, 2);

  assert.ok(
    Object.values(read.schema.properties!).every((p: any) => !("default" in p)),
  );

  await c.close();
  const reopened = new Store(db);
  const { Settings } = await import("../settings/settings.js");
  const settings = new Settings(reopened, () => ["fixture"]);
  assert.equal(settings.values("alice").default_worker_profile, "implementer");
  assert.equal(settings.values("alice").max_cost_usd, 2);
  reopened.close();
});

test("task tools honor defaults and explicit overrides without changing existing tasks", async () => {
  const { c } = await setup();
  const { callTool } = await import("../../platform/server/tools.js");

  c.settings.update("alice", {
    set: {
      max_runtime_minutes: 9,
      max_cost_usd: 3,
      default_worker_profile: "implementer",
    },
  });

  const task: any = await callTool(c, "alice", "start_agent_task", {
    title: "Test default merge",
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
    title: "Other owner defaults",
    description: "Other owner defaults",
  });

  assert.equal(other.worker_profile, "reviewer");
  assert.equal(other.budget.max_runtime_minutes, 20);
  await c.close();
});

test("settings reject unsupported providers, invalid budgets, unknown fields and empty updates atomically", async () => {
  const { c } = await setup();
  const original = c.settings.values("alice");

  for (const set of [
    { default_provider: "claude", max_cost_usd: 1 },
    { max_runtime_minutes: 0 },
    { max_cost_usd: 101 },
    { approval_policy: "allow_all" },
    {},
  ]) {
    assert.throws(() => c.settings.update("alice", { set }));
    assert.deepEqual(c.settings.values("alice"), original);
  }

  await c.close();
});

test("durable task completes in isolated worktree and produces structured artifact", async () => {
  const { c, store, repo, db } = await setup();
  const t = await c.start("alice", input());
  await until(() => store.get(t.id, "alice").status === "completed");
  const done = store.get(t.id, "alice");
  assert.notEqual(done.workspace, repo);
  assert.equal(done.session_owner, c.ownerWorker);
  assert.ok(done.session_state_ref);
  assert.ok(done.result?.summary.includes("Fixture"));
  assert.equal(store.artifacts(t.id, "alice")[0].type, "report");
  await c.close();
  const reopened = new Store(db);
  assert.equal(reopened.get(t.id, "alice").status, "completed");
  reopened.close();
});

test("ownership enforced across dependencies, artifacts, state, events and controls", async () => {
  const { c, store } = await setup();
  const t = await c.start("alice", input("[input]"));
  await until(() => store.get(t.id, "alice").status === "waiting");
  assert.throws(() => store.get(t.id, "bob"));
  assert.throws(() => store.events(t.id, "bob"));
  assert.throws(() => store.artifacts(t.id, "bob"));
  await assert.rejects(c.stop("bob", t.id, "cancelled"));
  await assert.rejects(c.start("bob", { ...input(), depends_on: [t.id] }));
  await c.close();
});

test("dependencies wait for completion and failed dependencies never run", async () => {
  const { c, store } = await setup();
  const first = await c.start("alice", input("[input]"));

  const second = await c.start("alice", {
    ...input("Review result"),
    depends_on: [first.id],
  });

  await until(() => store.get(first.id, "alice").status === "waiting");
  await until(() => store.get(second.id, "alice").status === "waiting");
  await c.stop("alice", first.id, "cancelled");
  await until(() => store.get(second.id, "alice").status === "failed");
  assert.equal(store.get(second.id, "alice").workspace, undefined);
  await c.close();
});

test("successful dependencies release and task hierarchy stays separate", async () => {
  const { c, store } = await setup();
  const a = await c.start("alice", input());

  const b = await c.start("alice", {
    ...input(),
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
  const { c, store } = await setup();
  const t = await c.start("alice", input("[input]"));
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

test("interrupt preserves session; continuation requires worker affinity", async () => {
  const { c, store } = await setup();
  const t = await c.start("alice", input("[input]"));
  await until(() => !!store.get(t.id, "alice").pending_input);
  await c.stop("alice", t.id, "interrupted");
  const previous = store.get(t.id, "alice").session_id;
  const moved = store.get(t.id, "alice");
  moved.session_owner = "another-worker";
  store.save(moved);
  await assert.rejects(c.continue("alice", t.id), /another worker/);
  moved.session_owner = c.ownerWorker;
  store.save(moved);
  await c.continue("alice", t.id);
  await until(() => !!store.get(t.id, "alice").pending_input);

  c.input("alice", t.id, store.get(t.id, "alice").pending_input!.id, true, {
    answer: "yes",
  });

  await until(() => store.get(t.id, "alice").status === "completed");
  assert.equal(store.get(t.id, "alice").session_id, previous);
  assert.equal(store.get(t.id, "alice").attempt, 2);
  await c.close();
});

test("steering does not lose instructions during active turn", async () => {
  const { c, store } = await setup();
  const t = await c.start("alice", input("[input]"));
  await until(() => !!store.get(t.id, "alice").pending_input);
  await c.steer("alice", t.id, "Focus on error handling");
  await until(() => !!store.get(t.id, "alice").pending_input);

  assert.ok(
    store.get(t.id, "alice").instructions.includes("Focus on error handling"),
  );

  await c.stop("alice", t.id, "cancelled");
  assert.equal(store.get(t.id, "alice").status, "cancelled");
  const retry = await c.retry("alice", t.id);
  assert.notEqual(retry.id, t.id);
  assert.equal(retry.parent_task_id, t.id);
  await c.close();
});

test("runtime budget stops a worker waiting for input", async () => {
  const { c, store } = await setup();

  const t = await c.start("alice", {
    ...input("[input]"),
    budget: { max_runtime_minutes: 0.002, max_cost_usd: 1 },
  });

  await until(() => store.get(t.id, "alice").status === "failed");
  assert.match(store.get(t.id, "alice").error!, /Runtime budget/);
  await c.close();
});

test("unsupported budgets and providers fail before starting work", async () => {
  const { c } = await setup();

  await assert.rejects(
    c.start("alice", { ...input(), budget: { max_tokens: 100 } }),
    /token budgets/,
  );

  await assert.rejects(
    c.start("alice", {
      provider: "claude",
      title: "test",
      description: "test",
    }),
    /not enabled/,
  );

  await c.close();
});

test("restart recovery marks live task interrupted and clears stale permissions", async () => {
  const { c, store } = await setup();
  const t = await c.start("alice", input("[input]"));
  await until(() => !!store.get(t.id, "alice").pending_input);
  await c.stop("alice", t.id, "interrupted");
  const old = store.get(t.id, "alice");
  old.status = "waiting";
  old.waiting_reason = "waiting_for_permission";
  old.pending_input = { id: "old", tool: "Bash", input: { command: "pwd" } };
  store.save(old);
  await c.recover();
  assert.equal(store.get(t.id, "alice").status, "interrupted");
  assert.equal(store.get(t.id, "alice").pending_input, undefined);
  await c.close();
});

test("workspace root allowlist rejects external repositories", async () => {
  const { c, dir } = await setup();

  await assert.rejects(
    c.start("alice", { ...input(), repository: dir }),
    /outside allowed roots/,
  );

  await c.close();
});

test("artifact includes edits, untracked files and committed changes without touching primary checkout", async () => {
  class Writer extends FixtureProvider {
    async run(c: RunContext, p: string) {
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
  const t = await c.start("alice", input());

  await until(
    () =>
      !c.active.has(t.id) && store.get(t.id, "alice").status === "completed",
  );

  const diff = store.artifacts(t.id, "alice").find((a) => a.type === "diff")!;
  assert.match(diff.content, /changed/);
  assert.match(diff.content, /answer = 42/);

  execFileSync("git", ["-C", repo, "apply", "--check", "-"], {
    input: diff.content,
  });

  assert.equal(await readFile(join(repo, "README.md"), "utf8"), "hello\n");
  await c.close();
});

test("scheduler enforces concurrency and independent branches run together", async () => {
  const { c, store } = await setup(undefined, 2);

  const tasks = await Promise.all([
    c.start("alice", input("[input]")),
    c.start("alice", input("[input]")),
    c.start("alice", input("[input]")),
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

  await c.stop("alice", tasks[0].id, "cancelled");
  await until(() => !!store.get(tasks[2].id, "alice").pending_input);
  await c.close();
});

test("parallel permission requests are serialized without losing the first response", async () => {
  class Parallel extends FixtureProvider {
    async run(c: RunContext, _prompt: string): Promise<Result> {
      const [first, second] = await Promise.all([
        c.input("Bash", { command: "first" }, c.signal),
        c.input("Bash", { command: "second" }, c.signal),
      ]);

      return {
        summary: JSON.stringify([first.approved, second.approved]),
        findings: [],
        evidence: [],
        changes: [],
        tests: [],
        recommendations: [],
      };
    }
  }

  const { c, store } = await setup(new Parallel());
  const t = await c.start("alice", input());
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
  assert.equal(store.get(t.id, "alice").result?.summary, "[true,false]");
  await c.close();
});

test("unsupported cost limits fail before task persistence and explicit null allows execution", async () => {
  const provider = new FixtureProvider();
  provider.capabilities.cost_budget = false;
  const { c } = await setup(provider);

  try {
    await assert.rejects(
      c.start("alice", input()),
      /does not support cost budgets/,
    );

    assert.equal(c.store.all().length, 0);

    const task = await c.start("alice", {
      ...input(),
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
  const { c, db } = await setup();
  c.settings.update("alice", { set: { max_cost_usd: null } });
  const task = await c.start("alice", input());
  assert.equal(task.budget.max_cost_usd, null);

  const limited = await c.start("alice", {
    ...input(),
    budget: { max_cost_usd: 2 },
  });

  assert.equal(limited.budget.max_cost_usd, 2);
  assert.equal(c.settings.values("bob").max_cost_usd, 5);
  await c.close();
  const store = new Store(db);
  const { Settings } = await import("../settings/settings.js");

  assert.equal(
    new Settings(store, () => ["fixture"]).values("alice").max_cost_usd,
    null,
  );

  store.close();
});

test("continuation revalidates provider budget support before changing an interrupted task", async () => {
  const provider = new FixtureProvider();
  const { c } = await setup(provider);
  c.stopped = true;

  try {
    const task = await c.start("alice", input());
    await c.stop("alice", task.id, "interrupted");
    provider.capabilities.cost_budget = false;

    await assert.rejects(
      c.continue("alice", task.id),
      /does not support cost budgets/,
    );

    assert.equal(c.store.get(task.id, "alice").status, "interrupted");
  } finally {
    await c.close();
  }
});

test("unconfirmed termination locks task controls, defers artifacts and survives service recovery", async () => {
  const { UnconfirmedTerminationError } =
    await import("../../shared/contracts.js");

  class UncertainProvider extends FixtureProvider {
    async run(c: RunContext): Promise<Result> {
      await writeFile(
        join(c.task.workspace!, "uncertain.txt"),
        "unverified work",
      );

      return await new Promise<Result>((_resolve, reject) => {
        const fail = () =>
          reject(
            new UnconfirmedTerminationError([new Error("cancel timeout")]),
          );

        if (c.signal.aborted) fail();
        else c.signal.addEventListener("abort", fail, { once: true });
      });
    }
  }

  const { c, db } = await setup(new UncertainProvider());
  const task = await c.start("alice", input());
  await until(() => c.store.get(task.id, "alice").status === "running");

  await assert.rejects(
    c.stop("alice", task.id, "cancelled"),
    /termination is unconfirmed/,
  );

  assert.equal(c.store.get(task.id, "alice").status, "waiting");

  assert.equal(
    c.store.get(task.id, "alice").waiting_reason,
    "termination_unconfirmed",
  );

  assert.deepEqual(c.store.artifacts(task.id, "alice"), []);

  await assert.rejects(
    c.stop("alice", task.id, "interrupted"),
    /termination is unconfirmed/,
  );

  await assert.rejects(
    c.steer("alice", task.id, "Continue"),
    /termination is unconfirmed/,
  );

  await assert.rejects(c.retry("alice", task.id), /requires failed/);
  await c.close();
  const store = new Store(db);
  const recovered = new Control(store, c.workspaces, c.providers, c.repository);
  recovered.stopped = true;
  await recovered.recover();

  assert.equal(
    store.get(task.id, "alice").waiting_reason,
    "termination_unconfirmed",
  );

  assert.equal(store.get(task.id, "alice").status, "waiting");
  await recovered.close();
});

test("Codex recovery locks unknown execution and permits explicit continuation only after provider proof", async () => {
  class RecoveringProvider extends FixtureProvider {
    id = "codex";
    proven = false;
    async recover() {
      if (!this.proven) throw new Error("executor shutdown unknown");
    }
  }

  const provider = new RecoveringProvider();
  const { c } = await setup(provider);
  c.stopped = true;

  try {
    const task = await c.start("alice", {
      provider: "codex",
      title: "Recover",
      description: "Recover",
      budget: { max_cost_usd: null },
    });

    task.status = "running";
    task.native_turn_id = "turn_one";
    c.store.save(task);
    await c.recover();

    assert.equal(
      c.store.get(task.id, "alice").waiting_reason,
      "termination_unconfirmed",
    );

    await assert.rejects(c.continue("alice", task.id), /Only interrupted/);
    c.providers.delete("codex");
    await c.recover();

    assert.equal(
      c.store.get(task.id, "alice").waiting_reason,
      "termination_unconfirmed",
    );

    c.providers.set("codex", provider);
    provider.proven = true;
    await c.recover();
    const recovered = c.store.get(task.id, "alice");
    assert.equal(recovered.status, "interrupted");
    assert.equal(recovered.waiting_reason, undefined);
    assert.equal(recovered.native_turn_id, "turn_one");
    assert.equal((await c.continue("alice", task.id)).status, "queued");
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
      summary: "Cancelled inputs skipped",
      findings: [],
      evidence: [],
      changes: [],
      tests: [],
      recommendations: [],
    };
  };

  const { c, store } = await setup(provider);

  try {
    const task = await c.start("alice", input());

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
