import assert from "node:assert/strict";

import { test } from "vitest";

import { FixtureProvider } from "../../../../../dev/service/fixture-provider.js";
import { claudeMetadata } from "../../../../shared/providers/metadata.js";
import type { ModelChoice } from "../../../../shared/providers/types.js";
import { claudeTaskPolicy } from "../../providers/claude/configuration/task-policy.js";
import type { Provider } from "../../providers/types.js";
import { input, setup, until } from "./control-test-harness.js";

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

test("workspace root allowlist rejects external repositories", async () => {
  const { c, dir, repo } = await setup();

  await assert.rejects(
    c.start("alice", { ...input(repo), repository: dir }),
    /outside allowed roots/,
  );

  await c.close();
});

test("unsupported budgets and providers fail before task persistence, and an explicit null cost limit runs", async () => {
  const provider = new FixtureProvider();
  provider.capabilities.cost_budget = false;
  const { c, repo } = await setup(provider);

  try {
    for (const [args, error] of [
      [{ ...input(repo), budget: { max_tokens: 100 } }, /token budgets/],
      [{ ...input(repo), provider: "claude" }, /not enabled/],
      [
        {
          ...input(repo),
          budget: { max_runtime_minutes: null, max_cost_usd: 1 },
        },
        /does not support cost budgets/,
      ],
    ] as const) {
      await assert.rejects(c.start("alice", args), error);
    }

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
