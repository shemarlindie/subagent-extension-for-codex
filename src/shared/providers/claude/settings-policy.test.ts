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
      setting: "permission_mode",
      value: "bypassPermissions",
      reason: "Turned off by your organization",
    },
    {
      setting: "sandbox",
      value: "extension",
      reason: "Your organization turned off the sandbox",
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
const SANDBOX = "providers.claude.sandbox";

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
    {
      label: "Bash sandbox",
      detail: "Your organization turned off the sandbox.",
    },
    { label: "Models", detail: "Limited to haiku." },
    { label: "Hooks", detail: "Only your organization's hooks run." },
  ]);
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
      claude: { permission_mode: "bypassPermissions", sandbox: "extension" },
    },
  });

  assert.equal(
    row(all, MODE).warning,
    "Your saved mode, Bypass permission prompts, is turned off by your organization. New tasks ask for approval.",
  );

  assert.match(
    row(all, SANDBOX).warning!,
    /can't start with your saved choice/,
  );

  assert.equal(row(sections({}), MODE).warning, undefined);
});

test("a saved model outside the allowlist warns on its scope", () => {
  const all = sections({ models: { global: { model: "opus" } } });

  const models = all.flatMap(({ rows }) =>
    rows.flatMap((item) => (item.kind === "models" ? item.scopes : [])),
  );

  assert.match(
    models.find(({ id }) => id === "global")?.model.warning ?? "",
    /doesn't allow this model/,
  );

  assert.equal(
    models.find(({ id }) => id === "claude")?.model.warning,
    undefined,
  );
});
