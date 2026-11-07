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

  assert.deepEqual(section?.facts, [
    {
      label: "Permission modes",
      detail: "Turned off: Bypass permission prompts.",
    },
    { label: "Models", detail: "Limited to haiku." },
    { label: "Hooks", detail: "Only your organization's hooks run." },
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
