import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test, type TestContext } from "vitest";

import { sectionPaths } from "../../../panel/features/settings/settings-layout.js";
import { claudeOverrideDefaults } from "../../../shared/providers/claude/permissions.js";
import type { ModelChoice } from "../../../shared/providers/types.js";
import { withHelp } from "../../../shared/settings/settings-document.js";
import {
  settingAt,
  settingPaths,
} from "../../../shared/settings/settings-schema.js";
import { Store } from "../tasks/storage/store.js";
import { Settings } from "./settings.js";
import {
  settingsReadOutputSchema,
  settingsUpdateOutputSchema,
} from "./settings-tool-schemas.js";

type Read = ReturnType<Settings["read"]>;

type SchemaNode = Record<string, unknown> & {
  properties?: Record<string, SchemaNode>;
  enum?: unknown[];
  description?: string;
};

// The JSON Schema node for a dotted settings path.
function schemaNode(result: Read, path: string) {
  return path
    .split(".")
    .reduce<SchemaNode | undefined>(
      (node, key) => node?.properties?.[key],
      result.schema as SchemaNode,
    );
}

// A schema property the test expects the settings document to expose.
function schemaField(result: Read, path: string) {
  const field = schemaNode(result, path);
  assert.ok(field, `${path} is in the settings schema`);

  return field;
}

// Every schema node below the root, by dotted path.
function schemaNodes(node: SchemaNode, prefix = ""): [string, SchemaNode][] {
  return Object.entries(node.properties ?? {}).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;

    return [[path, child] as [string, SchemaNode], ...schemaNodes(child, path)];
  });
}

const listed = (result: Read) => result.sections.flatMap(sectionPaths);

const budgets = (
  cost: { enabled?: boolean; amount?: number },
  runtime: { enabled?: boolean; amount?: number } = {},
) => ({ max_cost_usd: cost, max_runtime_minutes: runtime });

async function fixture(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "settings-test-"));
  const path = join(dir, "settings.sqlite");
  let store = new Store(path);
  let providers = ["fixture"];
  let settings = new Settings(store.database, () => providers);

  t.onTestFinished(async () => {
    if (store.database.client.isOpen) store.close();
    await rm(dir, { recursive: true, force: true });
  });

  return {
    get settings() {
      return settings;
    },
    get store() {
      return store;
    },
    setProviders(available: string[]) {
      providers = available;
    },
    stored() {
      return store.database.client
        .prepare("SELECT body FROM user_settings ORDER BY owner")
        .all();
    },
    reopen() {
      store.close();
      store = new Store(path);
      settings = new Settings(store.database, () => providers);
    },
  };
}

test("settings expose only enabled providers, off budgets with amounts, and a default per value", async (t) => {
  const { settings } = await fixture(t);
  const result = settings.read("alice");
  assert.deepEqual(settingsReadOutputSchema.parse(result), result);
  assert.equal(result.schema.type, "object");
  assert.deepEqual(schemaField(result, "task.provider").enum, ["fixture"]);

  for (const [path, field] of schemaNodes(result.schema)) {
    assert.equal("default" in field, false, `${path} has no schema default`);
  }

  // A budget is off by default and keeps the amount it restores when on.
  const initialBudgets = {
    max_cost_usd: { enabled: false, amount: 5 },
    max_runtime_minutes: { enabled: false, amount: 20 },
  };

  assert.deepEqual(settingAt(result.values, "task.budget"), initialBudgets);
  assert.deepEqual(settingAt(result.defaults, "task.budget"), initialBudgets);

  assert.deepEqual(
    settingPaths(result.defaults).sort(),
    settingPaths(result.values).sort(),
  );

  const [firstSection] = result.sections;
  assert.ok(firstSection);

  const select = firstSection.rows.find(
    (row) => row.kind === "select" && row.path === "task.provider",
  );

  // The panel gets labels, not just IDs.
  assert.deepEqual(select?.kind === "select" && select.options, [
    { value: "fixture", label: "Fixture" },
  ]);
});

test("settings sections have unique IDs and cover every shown value once", async (t) => {
  const { settings } = await fixture(t);
  const result = settings.read("alice");
  const ids = result.sections.map((section) => section.id);

  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(listed(result)).size, listed(result).length);

  // The execution approval mode is for agents and execution providers. The
  // panel presents native permission settings instead.
  assert.deepEqual(
    [...listed(result)].sort(),
    settingPaths(result.values)
      .filter((path) => path !== "approvals.execution_mode")
      .sort(),
  );

  // Budget rows carry their input minimum. Their settings sit under the path.
  const [firstSection] = result.sections;
  assert.ok(firstSection);

  const budget = firstSection.rows.find(
    (row) => row.kind === "budget" && row.path === "task.budget.max_cost_usd",
  );

  assert.deepEqual(budget?.kind === "budget" && [budget.unit, budget.min], [
    "USD",
    0.01,
  ]);

  assert.deepEqual(sectionPaths({ ...firstSection, rows: [budget!] }), [
    "task.budget.max_cost_usd.enabled",
    "task.budget.max_cost_usd.amount",
  ]);

  // Agents read the same help in each field's schema description.
  for (const row of result.sections.flatMap((section) => section.rows)) {
    if (row.kind !== "models" && row.help) {
      assert.equal(
        schemaField(result, row.path).description,
        row.help
          .map((part) => (typeof part === "string" ? part : part.text))
          .join(""),
        row.path,
      );
    }
  }
});

test("help links to settings the panel doesn't show become plain text", () => {
  assert.deepEqual(
    withHelp(
      [
        "Use ",
        { text: "Global", setting: "models.global.model" },
        " or ",
        { text: "Claude", setting: "models.providers.claude.model" },
        ".",
      ],
      { models: { global: { model: "" } } },
    ),
    [
      "Use ",
      { text: "Global", setting: "models.global.model" },
      " or ",
      "Claude",
      ".",
    ],
  );
});

test("disabled providers' model defaults are hidden but kept, and listed models share one note", async (t) => {
  const f = await fixture(t);
  f.setProviders(["fixture", "claude"]);

  f.settings.update("alice", {
    set: { models: { providers: { claude: { model: "kept" } } } },
  });

  // Only the fixture provider is enabled now.
  f.setProviders(["fixture"]);
  const hidden = f.settings.read("alice");

  assert.equal(schemaNode(hidden, "models.providers.claude"), undefined);

  assert.equal(
    (
      schemaField(hidden, "models.providers").required as string[] | undefined
    )?.includes("claude") ?? false,
    false,
  );

  assert.equal(settingAt(hidden.values, "models.providers.claude"), undefined);

  assert.equal(
    settingAt(hidden.defaults, "models.providers.claude"),
    undefined,
  );

  for (const path of [
    "models.providers.claude.model",
    "models.providers.claude.reasoning_effort",
  ]) {
    assert.equal(listed(hidden).includes(path), false, path);
  }

  const models = listed(hidden).filter((path) => path.endsWith(".model"));
  const note = schemaField(hidden, "models.global.model").description;
  assert.ok(note);

  assert.deepEqual(
    new Set(models.map((path) => schemaField(hidden, path).description)),
    new Set([note]),
  );

  // Enabling the provider again shows the saved value.
  f.setProviders(["fixture", "claude"]);
  const shown = f.settings.read("alice");
  assert.ok(listed(shown).includes("models.providers.claude.model"));

  assert.equal(
    settingAt(shown.values, "models.providers.claude.model"),
    "kept",
  );
});

test("native model controls scope discovered models and derive reasoning choices from effective SDK metadata", async (t) => {
  const f = await fixture(t);
  f.setProviders(["claude"]);

  f.settings.update("alice", {
    set: {
      task: { provider: "claude" },
      models: {
        global: { model: "claude-model" },
        profiles: { reviewer: { model: "custom-saved-model" } },
        providers: { claude: { reasoning_effort: "max" } },
      },
    },
  });

  const persisted = f.stored();

  const catalogs: { provider: string; models?: ModelChoice[] }[] = [
    {
      provider: "claude",
      models: [
        {
          value: "claude-model",
          displayName: "Claude",
          description: "",
          supportedEffortLevels: ["low", "high"],
        },
        {
          value: "default",
          displayName: "Default",
          description: "",
          supportsEffort: false,
        },
      ],
    },
  ];

  const result = f.settings.read("alice", catalogs);
  const field = (path: string) => schemaField(result, path);

  assert.deepEqual(field("models.providers.claude.model").enum, [
    "",
    "claude-model",
    "default",
  ]);

  assert.deepEqual(field("models.global.model").enum, [
    "",
    "claude-model",
    "default",
  ]);

  assert.deepEqual(field("models.profiles.reviewer.model").enum, [
    "",
    "claude-model",
    "default",
    "custom-saved-model",
  ]);

  const globalEfforts = field("models.global.reasoning_effort").enum!;
  assert.ok(globalEfforts.includes("none"));
  assert.ok(globalEfforts.includes("max"));

  assert.ok(
    field("models.profiles.reviewer.reasoning_effort").enum!.includes("none"),
  );

  assert.deepEqual(field("models.providers.claude.reasoning_effort").enum, [
    "default",
    "low",
    "high",
    "max",
  ]);

  assert.match(
    String(field("models.providers.claude.reasoning_effort").description),
    /Supported reasoning for claude model claude-model/,
  );

  assert.match(
    String(field("models.profiles.reviewer.reasoning_effort").description),
    /support is unknown/,
  );

  for (const [path, node] of schemaNodes(result.schema)) {
    if (Array.isArray(node.enum)) {
      assert.ok(
        node.enum.includes(settingAt(result.values, path)),
        `${path} must accept its saved value`,
      );
    }

    assert.equal("default" in node, false);
  }

  const models = result.sections.find((s) => s.id === "models")!,
    profiles = result.sections.find((s) => s.id === "profile-models")!;

  assert.equal(models.title, "Model defaults");
  assert.ok(sectionPaths(profiles).includes("models.profiles.reviewer.model"));

  // Model options carry display names and keep a saved custom ID.
  const scopes = profiles.rows.flatMap((row) =>
      row.kind === "models" ? row.scopes : [],
    ),
    reviewer = scopes.find((scope) => scope.label === "Reviewer");

  assert.equal(scopes[0]?.label, "General");
  assert.ok(reviewer);
  assert.equal(reviewer.id, "reviewer");

  assert.deepEqual(
    reviewer.model.options?.map((option) => option.label),
    ["Inherit", "Claude", "Default", "custom-saved-model"],
  );

  assert.deepEqual(f.stored(), persisted);
});

test("settings preserve custom models and unknown metadata while disabling effort only when explicitly unsupported", async (t) => {
  const f = await fixture(t);
  const fixtureEffort = "models.providers.fixture.reasoning_effort";

  f.settings.update("alice", {
    set: {
      models: {
        global: { model: "custom-model" },
        providers: { fixture: { reasoning_effort: "high" } },
      },
    },
  });

  const unknown = f.settings.read("alice", [
    {
      provider: "fixture",
      models: [
        { value: "discovered", displayName: "Discovered", description: "" },
      ],
    },
  ]);

  assert.ok(
    schemaField(unknown, "models.global.model").enum!.includes("custom-model"),
  );

  assert.match(
    String(schemaField(unknown, fixtureEffort).description),
    /support is unknown/,
  );

  assert.ok(schemaField(unknown, fixtureEffort).enum!.includes("none"));

  f.settings.update("alice", {
    set: {
      models: { global: { model: "" }, providers: { fixture: { model: "" } } },
    },
  });

  const persisted = f.stored();

  const disabled = f.settings.read("alice", [
    {
      provider: "fixture",
      models: [
        {
          value: "default",
          displayName: "Default",
          description: "",
          supportsEffort: false,
        },
      ],
    },
  ]);

  assert.ok(
    schemaField(disabled, "models.global.reasoning_effort").enum!.includes(
      "high",
    ),
  );

  assert.deepEqual(schemaField(disabled, fixtureEffort).enum, [
    "default",
    "high",
  ]);

  assert.match(
    String(schemaField(disabled, fixtureEffort).description),
    /provider runtime default only/,
  );

  // The saved "high" effort is now unsupported: agents read it in the
  // description, and the panel gets a flag.
  assert.match(
    String(schemaField(disabled, fixtureEffort).description),
    /saved reasoning is not supported/,
  );

  const fixtureScope = disabled.sections
    .flatMap((s) => s.rows)
    .flatMap((row) => (row.kind === "models" ? row.scopes : []))
    .find((scope) => scope.effort.path === fixtureEffort);

  assert.equal(fixtureScope?.id, "fixture");
  assert.equal(fixtureScope?.effort.unsupported, true);

  const missing = f.settings.read("alice", [{ provider: "fixture" }]);

  assert.equal(
    schemaField(missing, "models.providers.fixture.model").enum,
    undefined,
  );

  assert.match(
    String(schemaField(missing, fixtureEffort).description),
    /support is unknown/,
  );

  assert.deepEqual(f.stored(), persisted);
});

test("model and reasoning defaults resolve independently from task through role, provider and global", async (t) => {
  const { settings } = await fixture(t);

  settings.update("alice", {
    set: {
      models: {
        global: { model: "global-model", reasoning_effort: "low" },
        providers: {
          fixture: { model: "provider-model", reasoning_effort: "medium" },
        },
        profiles: {
          reviewer: { model: "role-model", reasoning_effort: "high" },
        },
      },
    },
  });

  const resolve = (args: Record<string, unknown> = {}) => {
    const input = settings.taskInput("alice", args);

    return [input.model, input.reasoning_effort];
  };

  assert.deepEqual(
    resolve({ model: " task-model ", reasoning_effort: "max" }),
    ["task-model", "max"],
  );

  assert.deepEqual(resolve({ model: "task-model" }), ["task-model", "high"]);

  assert.deepEqual(resolve({ reasoning_effort: "none" }), [
    "role-model",
    "none",
  ]);

  assert.deepEqual(resolve({ model: " ", reasoning_effort: "default" }), [
    "role-model",
    "high",
  ]);

  assert.deepEqual(resolve({ worker_profile: "researcher" }), [
    "provider-model",
    "medium",
  ]);

  settings.update("alice", {
    set: {
      models: {
        profiles: { reviewer: { model: "" } },
        providers: { fixture: { reasoning_effort: "default" } },
      },
    },
  });

  assert.deepEqual(resolve(), ["provider-model", "high"]);

  assert.deepEqual(resolve({ worker_profile: "researcher" }), [
    "provider-model",
    "low",
  ]);

  settings.update("alice", {
    set: { models: { providers: { fixture: { model: "" } } } },
  });

  assert.deepEqual(resolve({ worker_profile: "researcher" }), [
    "global-model",
    "low",
  ]);

  settings.update("alice", {
    set: { models: { global: { model: "", reasoning_effort: "default" } } },
  });

  assert.deepEqual(resolve({ worker_profile: "researcher" }), [
    undefined,
    undefined,
  ]);
});

test("effective provider and role select the matching defaults and isolate owners", async (t) => {
  const f = await fixture(t);
  f.setProviders(["fixture", "claude"]);

  f.settings.update("alice", {
    set: {
      task: { provider: "claude", worker_profile: "researcher" },
      models: {
        providers: {
          claude: { model: "claude-model" },
          fixture: { model: "fixture-model" },
        },
        profiles: {
          researcher: { reasoning_effort: "high" },
          reviewer: { model: "review-model" },
        },
      },
    },
  });

  const defaults = f.settings.taskInput("alice", {});
  assert.equal(defaults.model, "claude-model");
  assert.equal(defaults.reasoning_effort, "high");

  assert.equal(
    f.settings.taskInput("alice", { provider: "fixture" }).model,
    "fixture-model",
  );

  assert.equal(
    f.settings.taskInput("alice", { worker_profile: "reviewer" }).model,
    "review-model",
  );

  assert.equal(f.settings.taskInput("bob", {}).model, undefined);
  assert.equal(f.settings.taskInput("bob", {}).reasoning_effort, undefined);
  f.reopen();
  assert.equal(f.settings.taskInput("alice", {}).model, "claude-model");
  assert.equal(f.settings.taskInput("alice", {}).reasoning_effort, "high");

  assert.equal(
    f.settings.values("bob").models.profiles.researcher.reasoning_effort,
    "default",
  );
});

test("invalid settings updates cannot partially persist other settings", async (t) => {
  const f = await fixture(t);

  f.settings.update("alice", {
    set: {
      models: { global: { model: "saved-model", reasoning_effort: "medium" } },
      task: { budget: budgets({}, { enabled: true, amount: 121 }) },
    },
  });

  const original = f.stored();
  const runtime = (amount: number) => budgets({}, { amount });

  const invalid: [set: unknown, error?: RegExp][] = [
    [{ task: { provider: "claude", budget: runtime(10) } }, /not enabled/],
    [{ task: { budget: runtime(0) } }],
    [{ task: { budget: budgets({ enabled: true, amount: 0 }) } }],
    [{ task: { budget: budgets({ enabled: "yes" as unknown as boolean }) } }],
    // Budgets are groups, so an old number or null no longer stands for one.
    [{ task: { budget: { max_cost_usd: 7 } } }],
    [{ task: { budget: { max_cost_usd: null } } }],
    [{ approval_policy: "allow_all" }],
    [{ unknown: true }],
    [{ task: { unknown: true } }],
    [{ default_provider: "fixture" }],
    [{}, /Set at least one setting/],
    [{ task: { budget: {} } }, /Set at least one setting/],
    ...(
      [
        { models: { global: { model: 123 } } },
        { models: { global: { model: "x".repeat(201) } } },
        { models: { global: { reasoning_effort: "unsupported" } } },
        { models: { profiles: { reviewer: { reasoning_effort: 1 } } } },
        { models: { providers: { unknown: { model: "unknown" } } } },
      ] as Record<string, unknown>[]
    ).map(
      (set) => [{ task: { budget: runtime(11) }, ...set }] as [set: unknown],
    ),
  ];

  for (const [set, error] of invalid) {
    assert.throws(
      () => f.settings.update("alice", { set }),
      error ?? Error,
      JSON.stringify(set),
    );

    assert.deepEqual(f.stored(), original);
  }
});

test("invalid task selections fail before inherited defaults can hide them", async (t) => {
  const { settings } = await fixture(t);

  settings.update("alice", {
    set: {
      models: { global: { model: "fallback-model", reasoning_effort: "high" } },
    },
  });

  for (const args of [
    { model: 123 },
    { model: null },
    { model: "x".repeat(201) },
    { reasoning_effort: "unsupported" },
    { reasoning_effort: null },
  ]) {
    assert.throws(() => settings.taskInput("alice", args));
  }
});

test("budget switches keep the amount across edits and restart", async (t) => {
  const f = await fixture(t);

  f.settings.update("alice", {
    set: {
      task: {
        budget: budgets(
          { enabled: true, amount: 7 },
          { enabled: true, amount: 9 },
        ),
      },
    },
  });

  const disabled = f.settings.update("alice", {
    set: { task: { budget: budgets({ enabled: false }) } },
  });

  assert.deepEqual(settingsUpdateOutputSchema.parse(disabled), disabled);

  assert.deepEqual(settingAt(disabled.values, "task.budget.max_cost_usd"), {
    enabled: false,
    amount: 7,
  });

  assert.deepEqual(
    settingAt(f.settings.read("alice").values, "task.budget.max_cost_usd"),
    {
      enabled: false,
      amount: 7,
    },
  );

  const taskBudget = () =>
    f.settings.taskInput("alice", { description: "Review" }).budget;

  assert.equal(taskBudget().max_cost_usd, null);

  // A host resubmits the amount when another setting changes. The off switch wins.
  f.settings.update("alice", {
    set: {
      task: {
        worker_profile: "implementer",
        budget: budgets({ enabled: false, amount: 11 }),
      },
    },
  });

  f.reopen();

  assert.deepEqual(
    settingAt(f.settings.read("alice").values, "task.budget.max_cost_usd"),
    {
      enabled: false,
      amount: 11,
    },
  );

  // Editing the amount leaves the limit off.
  f.settings.update("alice", {
    set: { task: { budget: budgets({ amount: 12 }) } },
  });

  assert.deepEqual(f.settings.values("alice").task.budget.max_cost_usd, {
    enabled: false,
    amount: 12,
  });

  assert.equal(taskBudget().max_cost_usd, null);

  const enabled = f.settings.update("alice", {
    set: { task: { budget: budgets({ enabled: true }) } },
  });

  assert.deepEqual(settingAt(enabled.values, "task.budget.max_cost_usd"), {
    enabled: true,
    amount: 12,
  });

  assert.deepEqual(taskBudget(), { max_runtime_minutes: 9, max_cost_usd: 12 });
  assert.equal(f.settings.values("alice").task.worker_profile, "implementer");

  assert.deepEqual(
    settingAt(f.settings.read("bob").values, "task.budget.max_cost_usd"),
    {
      enabled: false,
      amount: 5,
    },
  );
});

test("removed providers fall back on effective reads without rewriting saved defaults", async (t) => {
  const f = await fixture(t);
  f.setProviders(["claude", "fixture"]);

  f.settings.update("alice", {
    set: {
      task: {
        provider: "claude",
        budget: budgets({}, { enabled: true, amount: 7 }),
      },
    },
  });

  const persisted = f.stored();
  f.setProviders(["fixture"]);
  f.reopen();

  assert.equal(
    settingAt(f.settings.read("alice").values, "task.provider"),
    "fixture",
  );

  assert.equal(
    f.settings.taskInput("alice", { description: "Review" }).provider,
    "fixture",
  );

  assert.deepEqual(
    schemaField(f.settings.read("alice"), "task.provider").enum,
    ["fixture"],
  );

  assert.deepEqual(f.stored(), persisted);
  f.setProviders(["claude", "fixture"]);

  assert.equal(
    settingAt(f.settings.read("alice").values, "task.provider"),
    "claude",
  );

  assert.deepEqual(f.settings.values("alice").task.budget.max_runtime_minutes, {
    enabled: true,
    amount: 7,
  });

  assert.deepEqual(f.stored(), persisted);
});

test("Claude session restrictions are scalar user-only settings with stored defaults", async (t) => {
  const f = await fixture(t);

  const keys = ["sandbox", "subagents", "settings_files", "user_mcp"] as const;

  const before = f.settings.values("alice");

  assert.deepEqual(
    Object.fromEntries(keys.map((key) => [key, before.providers.claude[key]])),
    claudeOverrideDefaults,
  );

  const read = f.settings.read("alice");
  assert.equal(schemaField(read, "providers").userOnly, true);

  for (const key of keys) {
    const field = schemaField(read, `providers.claude.${key}`);
    assert.equal(field.type, "boolean", key);
    assert.equal(Object.hasOwn(field, "default"), false, key);
  }

  assert.deepEqual(
    sectionPaths(
      read.sections.find((section) => section.id === "restrictions")!,
    ),
    keys.map((key) => `providers.claude.${key}`),
  );

  f.settings.update("alice", {
    set: {
      providers: {
        claude: {
          sandbox: true,
          subagents: true,
          settings_files: false,
          user_mcp: false,
        },
      },
    },
  });

  f.reopen();
  const after = f.settings.values("alice");
  assert.equal(after.providers.claude.sandbox, true);
  assert.equal(after.providers.claude.subagents, true);
  assert.equal(after.providers.claude.settings_files, false);
  assert.equal(after.providers.claude.user_mcp, false);
  assert.equal(after.task.budget.max_runtime_minutes.enabled, false);

  assert.throws(() =>
    f.settings.update("alice", {
      set: { providers: { claude: { sandbox: "extension" } } },
    }),
  );
});

test("settings accept a new built-in's metadata without provider-ID handling", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "provider-settings-test-"));
  const store = new Store(join(dir, "settings.sqlite"));

  t.onTestFinished(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  const settings = new Settings(
    store.database,
    () => ["new-built-in"],
    () => ({
      displayName: "New built-in",
    }),
  );

  const result = settings.read("alice");
  assert.equal(settingAt(result.values, "task.provider"), "new-built-in");
  assert.deepEqual(schemaField(result, "task.provider").enum, ["new-built-in"]);

  settings.update("alice", {
    set: {
      task: { provider: "new-built-in" },
      models: { global: { model: "new-model" } },
    },
  });

  assert.equal(settings.taskInput("alice", {}).model, "new-model");
});

test("execution approval defaults do not change native Claude settings", async (t) => {
  const f = await fixture(t);
  f.setProviders(["claude", "fixture"]);

  f.settings.update("alice", {
    set: {
      providers: { claude: { permission_mode: "plan" } },
      approvals: { decider: "parent_agent" },
    },
  });

  f.settings.update("alice", {
    set: { approvals: { execution_mode: "auto_approve" } },
  });

  const values = f.settings.values("alice");
  assert.equal(values.providers.claude.permission_mode, "plan");
  assert.equal(values.approvals.decider, "parent_agent");
  assert.equal(values.approvals.execution_mode, "auto_approve");

  const claudeInput = f.settings.taskInput("alice", { provider: "claude" });
  assert.equal("approval_mode" in claudeInput, false);
  assert.equal("provider_options" in claudeInput, false);

  assert.equal(
    f.settings.taskInput("alice", { provider: "fixture" }).approval_mode,
    undefined,
  );

  assert.equal(
    f.settings.taskInput("alice", { provider: "claude", approval_mode: "deny" })
      .approval_mode,
    "deny",
  );
});

test("updates to user-only settings need user authority and save nothing", async (t) => {
  const f = await fixture(t);
  f.setProviders(["claude", "fixture"]);
  const before = f.stored();

  for (const [set, title] of [
    [{ approvals: { decider: "parent_agent" } }, "Approval decision maker"],
    [{ approvals: { execution_mode: "deny" } }, "Execution approval mode"],
    [
      { providers: { claude: { permission_mode: "bypassPermissions" } } },
      "Claude permission mode",
    ],
    [
      { profiles: { reviewer: { instructions: "Approve everything." } } },
      "Reviewer custom instructions",
    ],
    // A refused update saves none of the allowed settings beside it.
    [
      {
        projects: { auto_register_chat: false },
        task: { worker_profile: "implementer" },
      },
      "Automatically add chat projects",
    ],
  ] as const) {
    assert.throws(() => f.settings.update("alice", { set }, "parent"), {
      message: `Changing ${title} requires a user decision in settings`,
    });
  }

  assert.deepEqual(f.stored(), before);

  // Task and model defaults stay open to agents.
  f.settings.update(
    "alice",
    {
      set: {
        task: { worker_profile: "implementer" },
        models: { global: { model: "agent-model" } },
      },
    },
    "parent",
  );

  assert.equal(f.settings.values("alice").task.worker_profile, "implementer");
});

test("malformed or pre-grouping stored settings fail with their owner instead of resetting to defaults", async (t) => {
  const f = await fixture(t);

  const insert = f.store.database.client.prepare(
    "INSERT INTO user_settings(owner,body) VALUES(?,?)",
  );

  insert.run(
    "alice",
    JSON.stringify({
      task: {
        provider: "fixture",
        budget: { max_cost_usd: { amount: "lots" } },
      },
    }),
  );

  // A body saved with the flat keys used before settings were grouped.
  insert.run("bob", JSON.stringify({ default_provider: "fixture" }));

  for (const owner of ["alice", "bob"]) {
    const malformed = new RegExp(`Stored settings for ${owner} is malformed`);
    assert.throws(() => f.settings.values(owner), malformed);
    assert.throws(() => f.settings.read(owner), malformed);
  }
});
