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

const models = [
  {
    value: "haiku",
    resolvedModel: "claude-haiku-5-5",
    displayName: "Haiku",
    description: "",
  },
];

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

  assert.match(row(all, MODE).warning ?? "", /Auto, isn't available/);

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
    "Your saved mode, Bypass permission prompts, is turned off by your organization. New tasks ask for approval.",
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

test("the org's default model locks Global, Claude and profile rows, and reasoning locks apart", () => {
  const saved = {
    models: {
      global: { model: "haiku" },
      profiles: { implementer: { reasoning_effort: "high" } },
    },
  };

  const modelOnly = sections(saved, {
    ...policy,
    default_model: { id: "claude-sonnet-5-5", name: "Sonnet 5.5" },
  });

  const rows = scopes(modelOnly);

  for (const id of ["global", "claude", "reviewer", "implementer"]) {
    assert.equal(rows[id]?.model.locked, "Sonnet 5.5");
    assert.equal(rows[id]?.effort.locked, undefined);
  }

  // Only a saved value warns, by name.
  assert.equal(
    rows.global?.model.warning,
    "Your saved model, Haiku, applies again if your organization stops setting a default.",
  );

  assert.equal(rows.claude?.model.warning, undefined);

  // Each section explains the lock once.
  for (const id of ["models", "profile-models"]) {
    const help = modelOnly.find((section) => section.id === id)?.help ?? [];

    assert.equal(
      help.at(-1),
      " Your organization's default model is Sonnet 5.5. To change it for one task, use the composer.",
    );
  }

  const effort = scopes(sections(saved, { ...policy, default_effort: "low" }));

  assert.equal(effort.implementer?.model.locked, undefined);
  assert.equal(effort.implementer?.effort.locked, "Low");

  assert.equal(
    effort.implementer?.effort.warning,
    "Your saved reasoning, High, applies again if your organization stops setting a default.",
  );

  // A saved value the org's default matches, by model ID, doesn't warn.
  const same = scopes(
    sections(saved, {
      ...policy,
      default_model: { id: "claude-haiku-5-5", name: "Haiku" },
      default_effort: "high",
    }),
  );

  assert.equal(same.global?.model.warning, undefined);
  assert.equal(same.implementer?.effort.warning, undefined);
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
    "New tasks run your saved reasoning at High, your organization's limit.",
  );

  assert.equal(scopes(all).global?.effort.warning, undefined);

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
