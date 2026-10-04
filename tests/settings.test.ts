import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test, type TestContext } from "vitest";

import type { ModelChoice } from "../src/core/model.js";
import { claudeOverrideDefaults } from "../src/core/permissions.js";
import {
  Settings,
  settingsReadOutputSchema,
  settingsUpdateOutputSchema,
} from "../src/core/settings.js";
import { Store } from "../src/core/store.js";

async function fixture(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "settings-test-"));
  const path = join(dir, "settings.sqlite");
  let store = new Store(path);
  let providers = ["fixture"];
  let settings = new Settings(store, () => providers);

  t.onTestFinished(async () => {
    if (store.db.isOpen) store.close();
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
      return store.db
        .prepare("SELECT body FROM user_settings ORDER BY owner")
        .all();
    },
    saveLegacy(owner: string) {
      store.db.prepare("INSERT INTO user_settings VALUES(?,?)").run(
        owner,
        JSON.stringify({
          default_provider: "fixture",
          default_worker_profile: "researcher",
          default_workspace_strategy: "current_repo",
          max_runtime_minutes: 14,
          max_cost_usd: null,
        }),
      );
    },
    saveRaw(owner: string, body: unknown) {
      store.db
        .prepare(
          "INSERT INTO user_settings VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET body=excluded.body",
        )
        .run(owner, JSON.stringify(body));
    },
    reopen() {
      store.close();
      store = new Store(path);
      settings = new Settings(store, () => providers);
    },
  };
}

test("native settings use scalar field schemas and expose only enabled providers", async (t) => {
  const { settings } = await fixture(t);
  const result = settings.read("alice");
  assert.deepEqual(settingsReadOutputSchema.parse(result), result);
  assert.equal(result.schema.type, "object");
  const properties = result.schema.properties!;
  assert.ok(Object.keys(properties).includes("use_cost_budget"));
  assert.deepEqual(properties.default_provider.enum, ["fixture"]);

  for (const [name, field] of Object.entries(properties)) {
    assert.ok(
      ["string", "number", "integer", "boolean"].includes(String(field.type)),
      name,
    );

    for (const keyword of ["anyOf", "oneOf", "allOf", "$ref", "default"]) {
      assert.equal(keyword in field, false, `${name} must not use ${keyword}`);
    }
  }

  assert.equal(result.values.use_cost_budget, true);
  assert.equal(result.values.max_cost_usd, 5);
});

test("automatic chat project registration is an on-by-default, persistent user setting", async (t) => {
  const f = await fixture(t);
  const result = f.settings.read("alice");
  const field = result.schema.properties!.auto_register_chat_project;
  assert.equal(field.type, "boolean");
  assert.equal(field.title, "Automatically add chat projects");
  assert.match(String(field.description), /host directory metadata/);
  assert.match(String(field.description), /keeps projects already registered/);
  assert.equal("default" in field, false);
  assert.equal(result.values.auto_register_chat_project, true);

  const items = (result.layout as { items: { property?: string }[] }[]).flatMap(
    (group) => group.items,
  );

  assert.ok(
    items.some((item) => item.property === "auto_register_chat_project"),
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

test("native settings use only host-supported bounds and add a panel action", async (t) => {
  const { settings } = await fixture(t);
  const result = settings.read("alice");
  for (const [name, field] of Object.entries(result.schema.properties!))
    assert.equal("exclusiveMinimum" in field, false, name);
  assert.equal(result.schema.properties!.max_runtime_minutes.minimum, 0.01);
  assert.equal(result.schema.properties!.max_cost_usd.minimum, 0.01);

  const items = (
    result.layout as { items: Record<string, unknown>[] }[]
  ).flatMap((group) => group.items);

  assert.deepEqual(
    items.filter((item) => item.kind === "tool").map((item) => item.tool),
    ["open_codex_subagent_extension_global"],
  );
});

test("native model controls scope discovered models and derive reasoning choices from effective SDK metadata", async (t) => {
  const f = await fixture(t);
  f.setProviders(["claude", "codex"]);

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
    {
      provider: "codex",
      models: [
        {
          value: "codex-model",
          displayName: "Codex",
          description: "",
          supportedEffortLevels: ["medium"],
        },
      ],
    },
  ];

  const result = f.settings.read("alice", catalogs);
  const fields = result.schema.properties!;

  assert.deepEqual(fields.claude_default_model.enum, [
    "",
    "claude-model",
    "default",
  ]);

  assert.equal("codex_default_model" in fields, false);
  assert.deepEqual(fields.default_model.enum, ["", "claude-model", "default"]);

  assert.deepEqual(fields.reviewer_default_model.enum, [
    "",
    "claude-model",
    "default",
    "custom-saved-model",
  ]);

  assert.ok(
    (fields.default_reasoning_effort.enum as unknown[]).includes("none"),
  );

  assert.ok(
    (fields.default_reasoning_effort.enum as unknown[]).includes("max"),
  );

  assert.ok(
    (fields.reviewer_default_reasoning_effort.enum as unknown[]).includes(
      "none",
    ),
  );

  assert.deepEqual(fields.claude_default_reasoning_effort.enum, [
    "default",
    "low",
    "high",
    "max",
  ]);

  assert.equal("codex_default_reasoning_effort" in fields, false);

  assert.match(
    String(fields.claude_default_reasoning_effort.description),
    /Supported efforts for claude model claude-model/,
  );

  assert.match(
    String(fields.reviewer_default_reasoning_effort.description),
    /support is unknown/,
  );

  for (const [key, field] of Object.entries(fields)) {
    if (Array.isArray(field.enum))
      assert.ok(
        field.enum.includes((result.values as Record<string, unknown>)[key]),
        `${key} must accept its saved value`,
      );
    assert.equal("default" in field, false);
    assert.ok(["string", "number", "boolean"].includes(String(field.type)));
  }

  const groups = result.layout as {
    title: string;
    items: { property: string }[];
  }[];

  assert.ok(groups.some((group) => group.title === "Global model defaults"));

  assert.ok(
    groups.some((group) =>
      group.items.some((item) => item.property === "reviewer_default_model"),
    ),
  );

  assert.deepEqual(f.stored(), persisted);
});

test("native settings preserve custom models and unknown metadata while disabling effort only when explicitly unsupported", async (t) => {
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
    (unknown.schema.properties!.default_model.enum as unknown[]).includes(
      "custom-model",
    ),
  );

  assert.match(
    String(
      unknown.schema.properties!.fixture_default_reasoning_effort.description,
    ),
    /support is unknown/,
  );

  assert.ok(
    (
      unknown.schema.properties!.fixture_default_reasoning_effort
        .enum as unknown[]
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
      disabled.schema.properties!.default_reasoning_effort.enum as unknown[]
    ).includes("high"),
  );

  assert.deepEqual(
    disabled.schema.properties!.fixture_default_reasoning_effort.enum,
    ["default", "high"],
  );

  assert.match(
    String(
      disabled.schema.properties!.fixture_default_reasoning_effort.description,
    ),
    /provider runtime default only/,
  );

  const missing = f.settings.read("alice", [{ provider: "fixture" }]);

  assert.equal(
    missing.schema.properties!.fixture_default_model.enum,
    undefined,
  );

  assert.match(
    String(
      missing.schema.properties!.fixture_default_reasoning_effort.description,
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

test("legacy settings rows inherit runtime model defaults without a rewrite", async (t) => {
  const f = await fixture(t);
  f.saveLegacy("legacy");
  const persisted = f.stored();
  f.reopen();
  const values = f.settings.read("legacy").values;
  assert.equal(values.default_model, "");
  assert.equal(values.auto_register_chat_project, true);
  assert.equal(values.default_reasoning_effort, "default");
  assert.equal(values.fixture_default_model, "");
  assert.equal(values.researcher_default_reasoning_effort, "default");
  const input = f.settings.taskInput("legacy", {});
  assert.equal(input.model, undefined);
  assert.equal(input.reasoning_effort, undefined);
  assert.equal(input.worker_profile, "researcher");
  assert.equal(input.budget.max_runtime_minutes, 14);
  assert.equal(input.budget.max_cost_usd, null);
  assert.deepEqual(f.stored(), persisted);
  f.settings.update("legacy", { set: { default_model: "new-model" } });
  f.reopen();
  assert.equal(f.settings.taskInput("legacy", {}).model, "new-model");
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
    { codex_default_model: null },
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
    set: { max_cost_usd: 7, max_runtime_minutes: 9 },
  });

  const disabled = f.settings.update("alice", {
    set: { use_cost_budget: false },
  });

  assert.deepEqual(settingsUpdateOutputSchema.parse(disabled), disabled);
  assert.equal(disabled.values.use_cost_budget, false);
  assert.equal(disabled.values.max_cost_usd, 7);
  assert.equal(f.settings.values("alice").max_cost_usd, null);

  assert.equal(
    f.settings.taskInput("alice", { title: "Review", description: "Review" })
      .budget.max_cost_usd,
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
  assert.equal(f.settings.read("alice").values.max_cost_usd, 11);
  assert.equal(f.settings.read("alice").values.use_cost_budget, false);
  f.settings.update("alice", { set: { max_cost_usd: 12 } });
  assert.equal(f.settings.read("alice").values.use_cost_budget, false);
  assert.equal(f.settings.read("alice").values.max_cost_usd, 12);
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

  assert.equal(f.settings.read("bob").values.max_cost_usd, 5);
});

test("removed providers fall back on effective reads without rewriting saved defaults", async (t) => {
  const f = await fixture(t);
  f.setProviders(["claude", "fixture"]);

  f.settings.update("alice", {
    set: { default_provider: "claude", max_runtime_minutes: 7 },
  });

  const persisted = f.stored();
  f.setProviders(["fixture", "codex"]);
  f.reopen();
  assert.equal(f.settings.read("alice").values.default_provider, "fixture");

  assert.equal(
    f.settings.taskInput("alice", { title: "Review", description: "Review" })
      .provider,
    "fixture",
  );

  assert.deepEqual(
    f.settings.read("alice").schema.properties!.default_provider.enum,
    ["fixture"],
  );

  assert.deepEqual(f.stored(), persisted);
  f.setProviders(["claude", "fixture"]);
  assert.equal(f.settings.read("alice").values.default_provider, "claude");
  assert.equal(f.settings.values("alice").max_runtime_minutes, 7);
  assert.deepEqual(f.stored(), persisted);
});

test("legacy null budget updates remain compatible and validation is atomic", async (t) => {
  const f = await fixture(t);
  f.settings.update("alice", { set: { max_cost_usd: 13 } });
  f.settings.update("alice", { set: { max_cost_usd: null } });
  assert.equal(f.settings.read("alice").values.use_cost_budget, false);
  assert.equal(f.settings.read("alice").values.max_cost_usd, 13);
  const original = f.settings.read("alice");

  for (const set of [
    { default_provider: "claude", max_runtime_minutes: 10 },
    { use_cost_budget: true, max_cost_usd: 0 },
    { max_runtime_minutes: 121 },
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

test("Codex defaults are not offered and legacy Codex values are ignored", async (t) => {
  const f = await fixture(t);
  f.setProviders(["claude", "codex"]);
  const result = f.settings.read("alice");
  assert.deepEqual(result.schema.properties!.default_provider.enum, ["claude"]);

  assert.equal(
    Object.keys(result.schema.properties!).some((key) =>
      key.startsWith("codex_"),
    ),
    false,
  );

  assert.equal(
    (result.layout as { title: string }[]).some((group) =>
      group.title.startsWith("codex"),
    ),
    false,
  );

  for (const set of [
    { default_provider: "codex" },
    { codex_default_model: "codex-model" },
  ])
    assert.throws(() => f.settings.update("alice", { set }));
  f.saveLegacy("bob");
  f.settings.update("bob", { set: { max_runtime_minutes: 9 } });
  const raw = JSON.parse(String((f.stored().at(-1) as any).body));
  raw.default_provider = "codex";
  raw.codex_default_model = "codex-model";
  raw.codex_default_reasoning_effort = "high";
  f.saveRaw("bob", raw);
  const values = f.settings.read("bob").values as Record<string, unknown>;
  assert.equal(values.default_provider, "claude");
  assert.equal(values.max_runtime_minutes, 9);
  assert.equal("codex_default_model" in values, false);
  f.setProviders(["codex"]);
  assert.equal(f.settings.taskInput("bob", {}).provider, "claude");

  assert.equal(
    f.settings.taskInput("bob", { provider: "codex" }).provider,
    "codex",
  );
});

test("Claude session restrictions are scalar user-only settings with stored defaults", async (t) => {
  const f = await fixture(t);
  f.saveLegacy("alice");

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
    const field = read.schema.properties![key];
    assert.ok(["string", "boolean"].includes(field.type), key);
    assert.equal(Object.hasOwn(field, "default"), false, key);
  }

  assert.deepEqual(
    read.layout?.find((group) => group.title === "Claude session restrictions")
      ?.items,
    keys.map((property) => ({ kind: "property", property })),
  );

  for (const set of [
    { claude_sandbox: "user_config" },
    { claude_environment: "inherit" },
    { claude_tools: "all" },
    { claude_path_guard: "off" },
    { claude_subagents: true },
  ])
    assert.throws(
      () => f.settings.update("alice", { set }, "parent"),
      /user decision/,
    );
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
  assert.equal(after.max_runtime_minutes, 14);

  assert.throws(() =>
    f.settings.update("alice", { set: { claude_tools: "none" } }),
  );
});
