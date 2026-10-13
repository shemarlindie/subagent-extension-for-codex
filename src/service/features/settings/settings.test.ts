import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test, type TestContext } from "vitest";

import { sectionKeys } from "../../../panel/features/settings/settings-layout.js";
import { claudeOverrideDefaults } from "../../../shared/providers/claude/permissions.js";
import type { ModelChoice } from "../../../shared/providers/types.js";
import { withHelp } from "../../../shared/settings/settings-document.js";
import { Store } from "../tasks/storage/store.js";
import {
  Settings,
  settingsReadOutputSchema,
  settingsUpdateOutputSchema,
} from "./settings.js";

// A budget as the panel shows it: whether it applies, and its amount
// (remembered while off).
function budget(result: ReturnType<Settings["read"]>, key: string) {
  const row = result.sections
    .flatMap((section) => section.rows)
    .find((r) => r.kind === "budget" && r.key === key);

  const value = (result.values as Record<string, unknown>)[key];

  return [value !== null, value ?? (row?.kind === "budget" && row.amount)];
}

// A schema property the test expects the settings document to expose.
function schemaField(result: ReturnType<Settings["read"]>, key: string) {
  const field = result.schema.properties?.[key];
  assert.ok(field, `${key} is in the settings schema`);

  return field;
}

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

test("settings expose only enabled providers, nullable budgets, and a default per value", async (t) => {
  const { settings } = await fixture(t);
  const result = settings.read("alice");
  assert.deepEqual(settingsReadOutputSchema.parse(result), result);
  assert.equal(result.schema.type, "object");
  const properties = result.schema.properties!;
  assert.deepEqual(schemaField(result, "default_provider").enum, ["fixture"]);

  for (const [name, field] of Object.entries(properties)) {
    assert.equal("default" in field, false, `${name} has no schema default`);
  }

  // Budgets read as a number or null; the on/off switches are update-only.
  assert.equal("use_cost_budget" in result.values, false);
  assert.equal(result.values.max_cost_usd, null);
  assert.equal(result.values.max_runtime_minutes, null);
  assert.equal(result.defaults.max_cost_usd, null);
  assert.equal(result.defaults.max_runtime_minutes, null);

  assert.deepEqual(
    Object.keys(result.defaults).sort(),
    Object.keys(result.values).sort(),
  );

  const [firstSection] = result.sections;
  assert.ok(firstSection);

  const select = firstSection.rows.find(
    (row) => row.kind === "select" && row.key === "default_provider",
  );

  // The panel gets labels, not just IDs.
  assert.deepEqual(select?.kind === "select" && select.options, [
    { value: "fixture", label: "Fixture" },
  ]);
});

test("automatic chat project registration is an on-by-default, persistent user setting", async (t) => {
  const f = await fixture(t);
  const result = f.settings.read("alice");
  const field = schemaField(result, "auto_register_chat_project");
  assert.equal(field.type, "boolean");
  assert.equal(field.title, "Automatically add chat projects");
  assert.match(String(field.description), /host directory metadata/);
  assert.match(String(field.description), /keeps projects already registered/);
  assert.equal("default" in field, false);
  assert.equal(result.values.auto_register_chat_project, true);

  assert.ok(
    result.sections.some((section) =>
      sectionKeys(section).includes("auto_register_chat_project"),
    ),
  );

  f.settings.update("alice", { set: { auto_register_chat_project: false } });
  f.reopen();
  assert.equal(f.settings.values("alice").auto_register_chat_project, false);
  assert.equal(f.settings.values("bob").auto_register_chat_project, true);
  f.settings.update("alice", { set: { max_runtime_minutes: 9 } });
  assert.equal(f.settings.values("alice").auto_register_chat_project, false);
  f.settings.update("alice", { set: { auto_register_chat_project: true } });
  f.reopen();
  assert.equal(f.settings.values("alice").auto_register_chat_project, true);
});

test("automatic chat project registration cannot be changed by parent authority", async (t) => {
  const f = await fixture(t);
  f.settings.update("alice", { set: { auto_register_chat_project: true } });
  const persisted = f.stored();

  for (const enabled of [false, true]) {
    assert.throws(
      () =>
        f.settings.update(
          "alice",
          {
            set: {
              auto_register_chat_project: enabled,
              max_runtime_minutes: 9,
            },
          },
          "parent",
        ),
      /requires a user decision/,
    );

    assert.deepEqual(f.stored(), persisted);
  }
});

test("settings sections have unique IDs and cover every shown value once", async (t) => {
  const { settings } = await fixture(t);
  const result = settings.read("alice");

  const ids = result.sections.map((section) => section.id),
    listed = result.sections.flatMap(sectionKeys);

  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(listed).size, listed.length);
  assert.deepEqual([...listed].sort(), Object.keys(result.values).sort());

  // Budget rows carry their input minimum and the amount to show when off.
  const [firstSection] = result.sections;
  assert.ok(firstSection);

  const budget = firstSection.rows.find(
    (row) => row.kind === "budget" && row.key === "max_cost_usd",
  );

  assert.deepEqual(
    budget?.kind === "budget" && [
      budget.toggle,
      budget.unit,
      budget.min,
      budget.amount,
    ],
    ["use_cost_budget", "USD", 0.01, 5],
  );

  // Agents read the same help in each field's schema description.
  for (const row of result.sections.flatMap((section) => section.rows)) {
    if (row.kind !== "models" && row.help) {
      assert.equal(
        (result.schema.properties![row.key] as { description?: string })
          .description,
        row.help
          .map((part) => (typeof part === "string" ? part : part.text))
          .join(""),
        row.key,
      );
    }
  }
});

test("help links to settings the panel doesn't show become plain text", () => {
  assert.deepEqual(
    withHelp(
      [
        "Use ",
        { text: "Global", setting: "default_model" },
        " or ",
        { text: "Claude", setting: "claude_default_model" },
        ".",
      ],
      { default_model: {} },
    ),
    [
      "Use ",
      { text: "Global", setting: "default_model" },
      " or ",
      "Claude",
      ".",
    ],
  );
});

test("each model section's intro links only to the other section's exact settings", async (t) => {
  const { settings } = await fixture(t);
  const result = settings.read("alice");

  const sectionOf = (setting: string) =>
    result.sections.find((s) => sectionKeys(s).includes(setting))?.id;

  const links = (id: string) =>
    (result.sections.find((s) => s.id === id)!.help ?? [])
      .filter((part) => typeof part !== "string")
      .map((link) => [link.text, link.setting, sectionOf(link.setting)]);

  // Each section explains inheritance from its own rows' side.
  assert.deepEqual(links("models"), [
    ["worker profile", "reviewer_default_model", "profile-models"],
    ["Global", "default_model", "models"],
  ]);

  assert.deepEqual(links("profile-models"), [
    ["provider", "fixture_default_model", "models"],
    ["Global", "default_model", "models"],
  ]);

  // Agents get the whole chain in the schema.
  assert.match(
    String(schemaField(result, "default_model").description),
    /worker profile, then its provider, then the global default/,
  );
});

test("disabled providers' model defaults are hidden but kept, and listed models share one note", async (t) => {
  const f = await fixture(t);
  f.setProviders(["fixture", "claude"]);
  f.settings.update("alice", { set: { claude_default_model: "kept" } });

  // Only the fixture provider is enabled now.
  f.setProviders(["fixture"]);
  const hidden = f.settings.read("alice");

  const listed = (result: typeof hidden) =>
    result.sections.flatMap(sectionKeys);

  for (const key of [
    "claude_default_model",
    "claude_default_reasoning_effort",
  ]) {
    assert.equal(key in hidden.schema.properties!, false, key);
    assert.equal(listed(hidden).includes(key), false, key);
    assert.equal(key in hidden.values, false, key);
    assert.equal(hidden.schema.required?.includes(key) ?? false, false, key);
  }

  const models = listed(hidden).filter((key) => key.endsWith("_model"));
  assert.ok(schemaField(hidden, "default_model").description);

  assert.deepEqual(
    new Set(models.map((key) => schemaField(hidden, key).description)),
    new Set([schemaField(hidden, "default_model").description]),
  );

  // Enabling the provider again shows the saved value.
  f.setProviders(["fixture", "claude"]);
  const shown = f.settings.read("alice");
  assert.ok(listed(shown).includes("claude_default_model"));
  assert.equal(shown.values.claude_default_model, "kept");
});

test("native model controls scope discovered models and derive reasoning choices from effective SDK metadata", async (t) => {
  const f = await fixture(t);
  f.setProviders(["claude"]);

  f.settings.update("alice", {
    set: {
      default_provider: "claude",
      default_model: "claude-model",
      reviewer_default_model: "custom-saved-model",
      claude_default_reasoning_effort: "max",
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
  const fields = result.schema.properties!;

  assert.deepEqual(schemaField(result, "claude_default_model").enum, [
    "",
    "claude-model",
    "default",
  ]);

  assert.deepEqual(schemaField(result, "default_model").enum, [
    "",
    "claude-model",
    "default",
  ]);

  assert.deepEqual(schemaField(result, "reviewer_default_model").enum, [
    "",
    "claude-model",
    "default",
    "custom-saved-model",
  ]);

  assert.ok(
    (
      schemaField(result, "default_reasoning_effort").enum as unknown[]
    ).includes("none"),
  );

  assert.ok(
    (
      schemaField(result, "default_reasoning_effort").enum as unknown[]
    ).includes("max"),
  );

  assert.ok(
    (
      schemaField(result, "reviewer_default_reasoning_effort").enum as unknown[]
    ).includes("none"),
  );

  assert.deepEqual(
    schemaField(result, "claude_default_reasoning_effort").enum,
    ["default", "low", "high", "max"],
  );

  assert.match(
    String(schemaField(result, "claude_default_reasoning_effort").description),
    /Supported efforts for claude model claude-model/,
  );

  assert.match(
    String(
      schemaField(result, "reviewer_default_reasoning_effort").description,
    ),
    /support is unknown/,
  );

  for (const [key, field] of Object.entries(fields)) {
    if (Array.isArray(field.enum)) {
      assert.ok(
        field.enum.includes((result.values as Record<string, unknown>)[key]),
        `${key} must accept its saved value`,
      );
    }

    assert.equal("default" in field, false);
  }

  const models = result.sections.find((s) => s.id === "models")!,
    profiles = result.sections.find((s) => s.id === "profile-models")!;

  assert.equal(models.title, "Model defaults");
  assert.ok(sectionKeys(profiles).includes("reviewer_default_model"));

  // Model options carry display names and keep a saved custom ID.
  const reviewer = profiles.rows.flatMap((row) =>
    row.kind === "models" ? row.scopes : [],
  )[1];

  assert.ok(reviewer);
  assert.equal(reviewer.label, "Reviewer");

  assert.deepEqual(
    reviewer.model.options?.map((option) => option.label),
    ["Inherit", "Claude", "Default", "custom-saved-model"],
  );

  assert.deepEqual(f.stored(), persisted);
});

test("settings preserve custom models and unknown metadata while disabling effort only when explicitly unsupported", async (t) => {
  const f = await fixture(t);

  f.settings.update("alice", {
    set: {
      default_model: "custom-model",
      fixture_default_reasoning_effort: "high",
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
    (schemaField(unknown, "default_model").enum as unknown[]).includes(
      "custom-model",
    ),
  );

  assert.match(
    String(
      schemaField(unknown, "fixture_default_reasoning_effort").description,
    ),
    /support is unknown/,
  );

  assert.ok(
    (
      schemaField(unknown, "fixture_default_reasoning_effort").enum as unknown[]
    ).includes("none"),
  );

  f.settings.update("alice", {
    set: { default_model: "", fixture_default_model: "" },
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
    (
      schemaField(disabled, "default_reasoning_effort").enum as unknown[]
    ).includes("high"),
  );

  assert.deepEqual(
    schemaField(disabled, "fixture_default_reasoning_effort").enum,
    ["default", "high"],
  );

  assert.match(
    String(
      schemaField(disabled, "fixture_default_reasoning_effort").description,
    ),
    /provider runtime default only/,
  );

  // The saved "high" effort is now unsupported: agents read it in the
  // description, and the panel gets a flag.
  assert.match(
    String(
      schemaField(disabled, "fixture_default_reasoning_effort").description,
    ),
    /saved effort is not supported/,
  );

  const fixtureScope = disabled.sections
    .flatMap((s) => s.rows)
    .flatMap((row) => (row.kind === "models" ? row.scopes : []))
    .find((scope) => scope.effort.key === "fixture_default_reasoning_effort");

  assert.equal(fixtureScope?.effort.unsupported, true);

  const missing = f.settings.read("alice", [{ provider: "fixture" }]);

  assert.equal(schemaField(missing, "fixture_default_model").enum, undefined);

  assert.match(
    String(
      schemaField(missing, "fixture_default_reasoning_effort").description,
    ),
    /support is unknown/,
  );

  assert.deepEqual(f.stored(), persisted);
});

test("model and reasoning defaults resolve independently from task through role, provider and global", async (t) => {
  const { settings } = await fixture(t);

  settings.update("alice", {
    set: {
      default_model: "global-model",
      default_reasoning_effort: "low",
      fixture_default_model: "provider-model",
      fixture_default_reasoning_effort: "medium",
      reviewer_default_model: "role-model",
      reviewer_default_reasoning_effort: "high",
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
      reviewer_default_model: "",
      fixture_default_reasoning_effort: "default",
    },
  });

  assert.deepEqual(resolve(), ["provider-model", "high"]);

  assert.deepEqual(resolve({ worker_profile: "researcher" }), [
    "provider-model",
    "low",
  ]);

  settings.update("alice", { set: { fixture_default_model: "" } });

  assert.deepEqual(resolve({ worker_profile: "researcher" }), [
    "global-model",
    "low",
  ]);

  settings.update("alice", {
    set: { default_model: "", default_reasoning_effort: "default" },
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
      default_provider: "claude",
      default_worker_profile: "researcher",
      claude_default_model: "claude-model",
      fixture_default_model: "fixture-model",
      researcher_default_reasoning_effort: "high",
      reviewer_default_model: "review-model",
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
    f.settings.values("bob").researcher_default_reasoning_effort,
    "default",
  );
});

test("invalid model and reasoning updates cannot partially persist other settings", async (t) => {
  const f = await fixture(t);

  f.settings.update("alice", {
    set: { default_model: "saved-model", default_reasoning_effort: "medium" },
  });

  const original = f.stored();

  for (const invalid of [
    { default_model: 123 },
    { default_model: "x".repeat(201) },
    { default_reasoning_effort: "unsupported" },
    { reviewer_default_reasoning_effort: 1 },
    { unknown_default_model: "unknown" },
  ]) {
    assert.throws(() =>
      f.settings.update("alice", {
        set: { max_runtime_minutes: 11, ...invalid },
      }),
    );

    assert.deepEqual(f.stored(), original);
  }
});

test("invalid task selections fail before inherited defaults can hide them", async (t) => {
  const { settings } = await fixture(t);

  settings.update("alice", {
    set: { default_model: "fallback-model", default_reasoning_effort: "high" },
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

test("native budget toggles preserve the numeric amount across edits and restart", async (t) => {
  const f = await fixture(t);

  f.settings.update("alice", {
    set: {
      max_cost_usd: 7,
      use_cost_budget: true,
      max_runtime_minutes: 9,
      use_runtime_budget: true,
    },
  });

  const disabled = f.settings.update("alice", {
    set: { use_cost_budget: false },
  });

  assert.deepEqual(settingsUpdateOutputSchema.parse(disabled), disabled);
  assert.equal(disabled.values.max_cost_usd, null);

  assert.deepEqual(budget(f.settings.read("alice"), "max_cost_usd"), [
    false,
    7,
  ]);

  assert.equal(f.settings.values("alice").max_cost_usd, null);

  assert.equal(
    f.settings.taskInput("alice", { description: "Review" }).budget
      .max_cost_usd,
    null,
  );

  // A host resubmits the amount when another setting changes; the disabled toggle must win.
  f.settings.update("alice", {
    set: {
      max_cost_usd: 11,
      use_cost_budget: false,
      default_worker_profile: "implementer",
    },
  });

  f.reopen();

  assert.deepEqual(budget(f.settings.read("alice"), "max_cost_usd"), [
    false,
    11,
  ]);

  f.settings.update("alice", { set: { max_cost_usd: 12 } });

  assert.deepEqual(budget(f.settings.read("alice"), "max_cost_usd"), [
    false,
    12,
  ]);

  assert.equal(f.settings.values("alice").max_cost_usd, null);

  const enabled = f.settings.update("alice", {
    set: { use_cost_budget: true },
  });

  assert.equal(enabled.values.max_cost_usd, 12);
  assert.equal(f.settings.values("alice").max_cost_usd, 12);
  assert.equal(f.settings.values("alice").max_runtime_minutes, 9);

  assert.equal(
    f.settings.values("alice").default_worker_profile,
    "implementer",
  );

  assert.equal(f.settings.read("bob").values.max_cost_usd, null);
});

test("removed providers fall back on effective reads without rewriting saved defaults", async (t) => {
  const f = await fixture(t);
  f.setProviders(["claude", "fixture"]);

  f.settings.update("alice", {
    set: {
      default_provider: "claude",
      max_runtime_minutes: 7,
      use_runtime_budget: true,
    },
  });

  const persisted = f.stored();
  f.setProviders(["fixture"]);
  f.reopen();
  assert.equal(f.settings.read("alice").values.default_provider, "fixture");

  assert.equal(
    f.settings.taskInput("alice", { description: "Review" }).provider,
    "fixture",
  );

  assert.deepEqual(
    schemaField(f.settings.read("alice"), "default_provider").enum,
    ["fixture"],
  );

  assert.deepEqual(f.stored(), persisted);
  f.setProviders(["claude", "fixture"]);
  assert.equal(f.settings.read("alice").values.default_provider, "claude");
  assert.equal(f.settings.values("alice").max_runtime_minutes, 7);
  assert.deepEqual(f.stored(), persisted);
});

test("null budget updates retain their amount and validation is atomic", async (t) => {
  const f = await fixture(t);

  f.settings.update("alice", {
    set: { max_cost_usd: 101, use_cost_budget: true },
  });

  assert.equal(f.settings.values("alice").max_cost_usd, 101);

  f.settings.update("alice", { set: { max_cost_usd: 13 } });
  f.settings.update("alice", { set: { max_cost_usd: null } });

  assert.deepEqual(budget(f.settings.read("alice"), "max_cost_usd"), [
    false,
    13,
  ]);

  f.settings.update("alice", {
    set: { max_runtime_minutes: 121, use_runtime_budget: true },
  });

  assert.equal(f.settings.values("alice").max_runtime_minutes, 121);

  const original = f.settings.read("alice");

  for (const set of [
    { default_provider: "claude", max_runtime_minutes: 10 },
    { use_cost_budget: true, max_cost_usd: 0 },
    { use_cost_budget: "yes" },
    { unknown: true },
    {},
  ]) {
    assert.throws(() => f.settings.update("alice", { set }));
    assert.deepEqual(f.settings.read("alice"), original);
  }

  f.reopen();
  f.settings.update("alice", { set: { use_cost_budget: true } });
  assert.equal(f.settings.values("alice").max_cost_usd, 13);
});

test("Claude session restrictions are scalar user-only settings with stored defaults", async (t) => {
  const f = await fixture(t);

  const keys = [
    "claude_sandbox",
    "claude_environment",
    "claude_tools",
    "claude_path_guard",
    "claude_subagents",
  ] as const;

  const before = f.settings.values("alice");

  assert.deepEqual(
    Object.fromEntries(keys.map((key) => [key, before[key]])),
    claudeOverrideDefaults,
  );

  const read = f.settings.read("alice");

  for (const key of keys) {
    const field = schemaField(read, key);
    assert.ok(["string", "boolean"].includes(String(field.type)), key);
    assert.equal(Object.hasOwn(field, "default"), false, key);
  }

  assert.deepEqual(
    sectionKeys(
      read.sections.find((section) => section.id === "restrictions")!,
    ),
    keys,
  );

  for (const set of [
    { claude_sandbox: "user_config" },
    { claude_environment: "inherit" },
    { claude_tools: "all" },
    { claude_path_guard: "off" },
    { claude_subagents: true },
  ]) {
    assert.throws(
      () => f.settings.update("alice", { set }, "parent"),
      /user decision/,
    );
  }

  assert.deepEqual(f.settings.values("alice"), before);

  f.settings.update("alice", {
    set: {
      claude_sandbox: "extension_locked",
      claude_tools: "profile",
      claude_subagents: true,
    },
  });

  f.reopen();
  const after = f.settings.values("alice");
  assert.equal(after.claude_sandbox, "extension_locked");
  assert.equal(after.claude_tools, "profile");
  assert.equal(after.claude_subagents, true);
  assert.equal(after.max_runtime_minutes, null);

  assert.throws(() =>
    f.settings.update("alice", { set: { claude_tools: "none" } }),
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
  assert.equal(result.values.default_provider, "new-built-in");

  assert.deepEqual(schemaField(result, "default_provider").enum, [
    "new-built-in",
  ]);

  settings.update("alice", {
    set: { default_provider: "new-built-in", default_model: "new-model" },
  });

  assert.equal(settings.taskInput("alice", {}).model, "new-model");
});

test("execution approval defaults do not change native Claude settings", async (t) => {
  const f = await fixture(t);
  f.setProviders(["claude", "fixture"]);

  f.settings.update("alice", {
    set: {
      claude_permission_mode: "plan",
      default_approval_decider: "parent_agent",
    },
  });

  f.settings.update("alice", {
    set: { default_approval_mode: "auto_approve" },
  });

  const values = f.settings.values("alice");
  assert.equal(values.claude_permission_mode, "plan");
  assert.equal(values.default_approval_decider, "parent_agent");
  assert.equal(values.default_approval_mode, "auto_approve");

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

test("malformed stored settings fail with their owner instead of resetting to defaults", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "settings-malformed-"));
  const store = new Store(join(dir, "settings.sqlite"));

  t.onTestFinished(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  store.database.client
    .prepare("INSERT INTO user_settings(owner,body) VALUES(?,?)")
    .run(
      "alice",
      JSON.stringify({ default_provider: "fixture", max_cost_usd: "lots" }),
    );

  const settings = new Settings(store.database, () => ["fixture"]);

  assert.throws(
    () => settings.values("alice"),
    /Stored settings for alice is malformed/,
  );
});
