import assert from "node:assert/strict";

import { test } from "vitest";

import { claudeMetadata } from "../../../../shared/providers/metadata.js";
import type {
  ModelChoice,
  ProviderPolicy,
} from "../../../../shared/providers/types.js";
import { Projects } from "../../projects/projects.js";
import { claudeTaskPolicy } from "../../providers/claude/configuration/task-policy.js";
import type { Provider } from "../../providers/types.js";
import { input, setup, TestProvider, until } from "./control-test-harness.js";

test("worker discovery exposes SDK metadata and falls back when discovery fails", async () => {
  const provider: Provider = new TestProvider();

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
    const [worker] = await c.availableWorkers("alice");
    assert.ok(worker);
    assert.deepEqual((worker as any).models, models);
    assert.equal(worker.provider, "fixture");

    provider.models = async () => {
      throw new Error("unavailable");
    };

    const fallback = (await c.availableWorkers("alice"))[0] as any;
    assert.equal(fallback.models, undefined);
    assert.match(fallback.model_discovery_error, /Model discovery unavailable/);
    assert.deepEqual(fallback.profiles, worker.profiles);
    assert.deepEqual(fallback.capabilities, worker.capabilities);
  } finally {
    await c.close();
  }
});

test("discovery and effort validation use each owner's current settings", async () => {
  const provider: Provider = new TestProvider();

  provider.models = async (settings) => [
    {
      value: "configured-model",
      displayName: "Configured model",
      description: "",
      supportsEffort: settings?.providers.claude.settings_files === false,
    },
  ];

  const { c, repo, store } = await setup(provider);

  try {
    c.settings.update("alice", {
      set: { providers: { claude: { settings_files: false } } },
    });

    const alice = (await c.availableWorkers("alice"))[0];
    const bob = (await c.availableWorkers("bob"))[0];
    assert.ok(alice && "models" in alice);
    assert.ok(bob && "models" in bob);
    assert.equal(alice.models?.[0]?.supportsEffort, true);
    assert.equal(bob.models?.[0]?.supportsEffort, false);

    const request = {
      ...input(repo),
      model: "configured-model",
      reasoning_effort: "high",
    };

    const task = await c.start("alice", request);
    await until(() => store.get(task.id, "alice").status === "completed");

    await assert.rejects(
      c.start("bob", request),
      /does not support reasoning effort high/,
    );

    c.settings.update("alice", {
      set: { providers: { claude: { settings_files: true } } },
    });

    await assert.rejects(
      c.start("alice", request),
      /does not support reasoning effort high/,
    );

    assert.equal(store.all().length, 1);
  } finally {
    await c.close();
  }
});

test("an unready provider blocks task starts and model discovery but stays listed", async () => {
  const provider: Provider = new TestProvider();
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
    const [worker] = (await c.availableWorkers("alice")) as any[];
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
      ((await c.availableWorkers("alice"))[0] as any).readiness.ready,
      true,
    );

    assert.equal(discoveries, 1);
  } finally {
    await c.close();
  }
});

test("known model effort metadata rejects invalid work before queueing while unknown metadata permits execution", async () => {
  const provider: Provider = new TestProvider();

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

    await Promise.all(
      [
        { model: "unknown-effort", reasoning_effort: "high" },
        { model: "custom-model", reasoning_effort: "high" },
        { model: "limited-effort", reasoning_effort: "low" },
      ].map(async ({ model, reasoning_effort }) => {
        const task = await c.start("alice", {
          ...input(repo),
          model,
          reasoning_effort,
        });

        await until(() => store.get(task.id, "alice").status === "completed");
        assert.equal(task.model, model);
      }),
    );

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
  const provider = new TestProvider();
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
        set: { models: { global: { reasoning_effort } } },
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
  const provider = new TestProvider();
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
  const provider = new TestProvider();
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
      task: {
        worker_profile: "implementer",
        budget: {
          max_runtime_minutes: { enabled: true, amount: 9 },
          max_cost_usd: { enabled: true, amount: 3 },
        },
      },
      profiles: {
        implementer: { instructions: "  Run the linter before replying.  " },
      },
    },
  });

  const task: any = await callTool(c, "alice", "start_task", {
    repository: repo,
    description: "Test default merge",
    budget: { max_cost_usd: 1 },
  });

  assert.equal(task.provider, "fixture");
  assert.equal(task.worker_profile, "implementer");
  assert.equal(task.budget.max_runtime_minutes, 9);
  assert.equal(task.budget.max_cost_usd, 1);
  assert.equal(task.profile_instructions, "Run the linter before replying.");

  c.settings.update("alice", {
    set: {
      task: { budget: { max_runtime_minutes: { amount: 7 } } },
      profiles: { implementer: { instructions: "" } },
    },
  });

  const saved = c.store.get(task.id, "alice");
  assert.equal(saved.budget.max_runtime_minutes, 9);
  assert.equal(saved.profile_instructions, "Run the linter before replying.");

  const other: any = await callTool(c, "bob", "start_task", {
    repository: repo,
    title: "Other owner defaults",
    description: "Other owner defaults",
  });

  assert.equal(other.worker_profile, "reviewer");
  assert.equal(other.profile_instructions, undefined);
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
  const request = store.get(t.id, "alice").pending_input!;
  assert.throws(() => c.input("bob", t.id, request.id, true));
  await assert.rejects(c.start("bob", { ...input(repo), depends_on: [t.id] }));
  await c.close();
});

test("unsupported budgets and providers fail before task persistence, and an explicit null cost limit runs", async () => {
  const provider = new TestProvider();
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

test("a turn queued before its project is removed fails instead of running", async () => {
  // No concurrency, so the task waits in the queue.
  const { c, repo, store } = await setup(undefined, 0);
  c.workspaces.allowedRoots = [];
  c.projects = new Projects(store.database, c.workspaces);
  const { repository } = await c.projects.register(repo);

  const queued = await c.start("owner", input(repo));
  await c.removeProject("owner", repository);
  c.concurrency = 1;
  void c.schedule();

  await until(() => store.get(queued.id, "owner").status === "failed");

  assert.match(
    store.get(queued.id, "owner").error ?? "",
    /outside allowed roots/,
  );

  assert.equal(store.get(queued.id, "owner").workspace, undefined);
});

const orgPolicy: ProviderPolicy = {
  managed: true,
  blocked: [
    {
      setting: "permission_mode",
      value: "bypassPermissions",
      reason: "Turned off by your organization",
    },
  ],
  available_models: ["haiku"],
  available_models_match: "prefix",
  notes: [],
};

/** A provider with Claude's options and the given org policy. */
async function underPolicy(
  policy: (() => Promise<ProviderPolicy | undefined>) | undefined,
) {
  const provider: Provider = new TestProvider();
  provider.id = "claude";
  provider.taskPolicy = claudeTaskPolicy;
  provider.metadata = claudeMetadata;

  provider.models = async () => [
    { value: "haiku", displayName: "Haiku", description: "" },
  ];

  if (policy) provider.policy = policy;

  const context = await setup(provider);

  return {
    ...context,
    start: (extra: object) =>
      context.c.start("alice", {
        ...input(context.repo),
        provider: "claude",
        ...extra,
      }),
  };
}

const bypass = {
  provider_options: { claude: { permission_mode: "bypassPermissions" } },
};

test("a mode or model a request names itself fails at start when policy rules it out", async () => {
  const { start } = await underPolicy(async () => orgPolicy);

  await assert.rejects(
    start(bypass),
    /Can't use permission mode bypassPermissions: Turned off by your organization/,
  );

  await assert.rejects(
    start({ model: "opus" }),
    /Your organization doesn't allow this model/,
  );

  assert.equal((await start({ model: "haiku" })).model, "haiku");
});

test("a saved mode that became blocked still starts, as Claude Code falls back itself", async () => {
  const { c, start } = await underPolicy(async () => orgPolicy);

  c.settings.update("alice", {
    set: { providers: { claude: { permission_mode: "bypassPermissions" } } },
  });

  const task = await start({});

  assert.equal(
    task.provider_options?.claude?.permission_mode,
    "bypassPermissions",
  );
});

test("a saved model policy excludes gives way to the default, with a note", async () => {
  const { c, start, store } = await underPolicy(async () => orgPolicy);

  c.settings.update("alice", {
    set: { models: { global: { model: "opus" } } },
  });

  const task = await start({});

  assert.ok(!task.model);

  assert.deepEqual(
    store
      .events(task.id, "alice")
      .filter((event) => event.type === "agent.limited")
      .map((event) => event.data),
    [
      {
        setting: "model",
        requested: "opus",
        effective: "default",
        reason:
          "Running with the default model. Your organization doesn't allow opus.",
      },
    ],
  );
});

test("failed discovery blocks no start", async () => {
  const { start } = await underPolicy(() =>
    Promise.reject(new Error("Discovery failed")),
  );

  assert.equal((await start({ model: "opus" })).model, "opus");
  assert.ok(await start(bypass));
});
