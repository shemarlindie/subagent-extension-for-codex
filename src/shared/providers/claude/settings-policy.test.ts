import assert from "node:assert/strict";

import { test } from "vitest";

import {
  type SettingRow,
  settingsSections,
} from "../../settings/settings-document.js";
import type { ProviderPolicy } from "../types.js";

const policy: ProviderPolicy = {
  managed: true,
  source: "console",
  blocked: [
    {
      value: "bypassPermissions",
      reason: "Turned off by your organization",
    },
  ],
  available_models: ["haiku"],
  available_models_match: "prefix",
  notes: [{ label: "Hooks", detail: "Only your organization's hooks run." }],
};

const models = [{ value: "haiku", displayName: "Haiku", description: "" }];

function sections(saved: object, catalogPolicy?: ProviderPolicy | null) {
  return settingsSections({
    values: { task: { provider: "claude" }, ...saved },
    providers: ["claude"],
    catalogs: [
      {
        provider: "claude",
        models,
        ...(catalogPolicy === null ? {} : { policy: catalogPolicy ?? policy }),
      },
    ],
  });
}

const row = (all: ReturnType<typeof sections>, path: string) => {
  const found = all
    .flatMap((section) => section.rows)
    .find(
      (item): item is Extract<SettingRow, { kind: "select" }> =>
        item.kind === "select" && item.path === path,
    );

  assert.ok(found);

  return found;
};

const MODE = "providers.claude.permission_mode";

test("the section is absent without an organization's policy", () => {
  const ids = (all: ReturnType<typeof sections>) => all.map(({ id }) => id);

  assert.ok(!ids(sections({}, null)).includes("organization-policy"));

  assert.ok(
    !ids(sections({}, { managed: false, blocked: [], notes: [] })).includes(
      "organization-policy",
    ),
  );
});

test("the section names the source and lists what's limited", () => {
  const section = sections({}).find(({ id }) => id === "organization-policy");

  assert.match(section?.help?.[0] as string, /admin console/);
  assert.deepEqual(section?.rows, []);

  assert.equal(
    scopes(sections({})).claude?.model.footer,
    "Your organization limits these models.",
  );

  assert.deepEqual(section?.facts, [
    {
      label: "Permission modes",
      detail: "Turned off: Bypass permission prompts.",
    },
    { label: "Models", detail: "Limited to haiku." },
    { label: "Hooks", detail: "Only your organization's hooks run." },
  ]);
});

test("the org's default model and reasoning lead the facts", () => {
  const facts = sections(
    {},
    {
      ...policy,
      default_model: { id: "claude-sonnet-5-5", name: "Sonnet 5.5" },
      default_effort: "low",
    },
  ).find(({ id }) => id === "organization-policy")?.facts;

  assert.deepEqual(facts?.slice(0, 2), [
    { label: "Default model", detail: "Sonnet 5.5." },
    { label: "Default reasoning", detail: "Low." },
  ]);
});

test("an empty allowlist reads as the default model", () => {
  const facts = sections({}, { ...policy, available_models: [] }).find(
    ({ id }) => id === "organization-policy",
  )?.facts;

  assert.ok(
    facts?.some(({ detail }) => detail === "Limited to the default model."),
  );
});

test("a mode blocked outside policy isn't blamed on the organization", () => {
  const all = sections(
    { providers: { claude: { permission_mode: "auto" } } },
    {
      ...policy,
      blocked: [
        {
          value: "auto",
          reason: "Not available with your Claude Code setup",
        },
      ],
    },
  );

  assert.equal(
    row(all, MODE).warning,
    "This mode isn't available. New tasks ask for approval.",
  );

  assert.ok(
    !all
      .find(({ id }) => id === "organization-policy")
      ?.facts?.some(({ label }) => label === "Permission modes"),
  );
});

test("blocked choices are locked with their reason, and others stay open", () => {
  const options = row(sections({}), MODE).options;
  const bypass = options.find(({ value }) => value === "bypassPermissions");

  assert.equal(bypass?.disabled, true);
  assert.equal(bypass?.description, "Turned off by your organization");

  assert.equal(
    options.find(({ value }) => value === "plan")?.disabled,
    undefined,
  );
});

test("a saved choice now blocked warns on its row, and nothing else does", () => {
  const all = sections({
    providers: {
      claude: { permission_mode: "bypassPermissions" },
    },
  });

  assert.equal(
    row(all, MODE).warning,
    "Your organization turned off this mode. New tasks ask for approval.",
  );

  assert.equal(row(sections({}), MODE).warning, undefined);
});

/** Each model scope by ID, across sections. */
const scopes = (all: ReturnType<typeof sections>) =>
  Object.fromEntries(
    all
      .flatMap((section) => section.rows)
      .flatMap((item) => (item.kind === "models" ? item.scopes : []))
      .map((scope) => [scope.id, scope]),
  );

test("the org's default is Claude's Inherit", () => {
  const all = sections(
    {},
    {
      ...policy,
      default_model: { id: "claude-sonnet-5-5", name: "Sonnet 5.5" },
      default_effort: "low",
    },
  );

  const rows = scopes(all);

  assert.equal(rows.claude?.model.options?.[0]?.label, "Inherit (Sonnet 5.5)");

  assert.equal(rows.claude?.effort.options[0]?.label, "Inherit (Low)");

  assert.equal(rows.reviewer?.model.options?.[0]?.label, "Inherit");
  assert.equal(rows.reviewer?.effort.options[0]?.label, "Inherit (Low)");

  const help = (id: string) =>
    all
      .find((section) => section.id === id)
      ?.help?.map((part) => (typeof part === "string" ? part : part.text))
      .join("");

  assert.equal(
    help("models"),
    "The task's worker profile defaults override these. Inherit uses your organization's default, Sonnet 5.5 with Low reasoning. Task choices override all defaults.",
  );

  assert.equal(
    help("profile-models"),
    "Inherit uses the task's provider default, then your organization's default, Sonnet 5.5 with Low reasoning. Task choices override profile defaults.",
  );
});

test("a model's own org reasoning shows where Inherit lands on it", () => {
  const perModel = { ...policy, model_default_effort: { haiku: "low" } };
  const claude = { model: "haiku", reasoning_effort: "high" };

  let rows = scopes(sections({ models: { providers: { claude } } }, perModel));

  assert.equal(rows.claude?.effort.options[0]?.label, "Inherit (Low)");
  assert.equal(rows.reviewer?.effort.options[0]?.label, "Inherit");

  rows = scopes(
    sections(
      { models: { providers: { claude: { model: "haiku" } } } },
      perModel,
    ),
  );

  assert.equal(rows.claude?.effort.options[0]?.label, "Inherit (Low)");

  // Another model runs without it.
  rows = scopes(
    sections(
      { models: { providers: { claude: { model: "opus" } } } },
      perModel,
    ),
  );

  assert.equal(rows.claude?.effort.options[0]?.label, "Inherit");

  const facts = sections({}, { ...perModel, default_effort: "medium" }).find(
    ({ id }) => id === "organization-policy",
  )?.facts;

  assert.ok(
    facts?.some(
      ({ label, detail }) =>
        label === "Default reasoning" &&
        detail === "Medium, and Low for haiku.",
    ),
  );
});

test("the org's reasoning cap locks higher levels and warns on a saved one above it", () => {
  const capped = { ...policy, max_effort: "high" };

  const all = sections(
    { models: { providers: { claude: { reasoning_effort: "xhigh" } } } },
    capped,
  );

  const claude = scopes(all).claude;

  assert.deepEqual(
    claude?.effort.options
      .filter(({ disabled }) => disabled)
      .map(({ value }) => value),
    ["xhigh", "max"],
  );

  assert.equal(
    claude?.effort.warning,
    "Your organization doesn't allow this level. New tasks use High.",
  );

  assert.ok(
    all
      .find(({ id }) => id === "organization-policy")
      ?.facts?.some(
        ({ label, detail }) =>
          label === "Reasoning" && detail === "Limited to High.",
      ),
  );
});

test("an org that denies approval prompts warns on the approval decider", () => {
  const all = sections({}, { ...policy, prompts_denied: true });

  assert.match(
    row(all, "approvals.decider").warning ?? "",
    /denies tool calls/,
  );

  assert.ok(
    all
      .find(({ id }) => id === "organization-policy")
      ?.facts?.some(({ label }) => label === "Approvals"),
  );

  assert.equal(row(sections({}), "approvals.decider").warning, undefined);
});
