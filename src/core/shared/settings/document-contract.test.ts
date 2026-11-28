import { expect, test } from "vitest";

import {
  settingRowSchema,
  settingSectionSchema,
} from "./document-contract.generated.js";
import type { ModelScope, SettingSection } from "./document-contract.js";
import { settingsSections } from "./settings-document.js";
import { settingsDefaults } from "./settings-schema.js";

const option = { value: "default", label: "Inherit" };

const scope: ModelScope = {
  id: "claude",
  label: "Claude",
  model: { path: "models.providers.claude.model", label: "Claude model" },
  effort: {
    path: "models.providers.claude.reasoning_effort",
    label: "Claude reasoning",
    options: [option],
    unsupported: false,
  },
};

test("rejects malformed setting rows", () => {
  for (const row of [
    { kind: "select", path: "task.provider", label: "Provider" },
    { kind: "models" },
    {
      kind: "models",
      scopes: [{ ...scope, effort: { ...scope.effort, options: undefined } }],
    },
    {
      kind: "text",
      path: "task.worktree_branch_prefix",
      label: "Prefix",
      maxLength: "100",
      pattern: "",
    },
    {
      kind: "budget",
      path: "task.budget.max_cost_usd",
      label: "Cost",
      unit: "USD",
      min: false,
    },
    { kind: "switch", path: 1, label: "Enabled" },
    { kind: "unknown", path: "unknown", label: "Unknown" },
  ]) {
    expect(settingRowSchema.safeParse(row).success, JSON.stringify(row)).toBe(
      false,
    );
  }
});

test("strips unknown fields throughout the settings document", () => {
  const help = { text: "Claude", setting: "models.providers.claude.model" };

  const section: SettingSection = {
    id: "models",
    title: "Model defaults",
    help: ["Use ", help],
    rows: [
      {
        kind: "select",
        path: "task.provider",
        label: "Provider",
        help: [help],
        options: [{ ...option, description: "Use the inherited value" }],
      },
      {
        kind: "models",
        scopes: [{ ...scope, model: { ...scope.model, options: [option] } }],
      },
    ],
  };

  expect(
    settingSectionSchema.parse({
      ...section,
      extra: true,
      help: ["Use ", { ...help, extra: true }],
      rows: [
        {
          ...section.rows[0],
          extra: true,
          help: [{ ...help, extra: true }],
          options: [
            { ...option, description: "Use the inherited value", extra: true },
          ],
        },
        {
          kind: "models",
          extra: true,
          scopes: [
            {
              ...scope,
              extra: true,
              model: {
                ...scope.model,
                extra: true,
                options: [{ ...option, extra: true }],
              },
              effort: {
                ...scope.effort,
                extra: true,
                options: [{ ...option, extra: true }],
              },
            },
          ],
        },
      ],
    }),
  ).toEqual(section);
});

test("validates sections produced for the settings dialog", () => {
  const values = settingsDefaults("claude");

  const sections = settingsSections({
    values,
    providers: ["claude"],
    catalogs: [],
  });

  expect(sections.length).toBeGreaterThan(0);

  for (const section of sections) {
    expect(settingSectionSchema.parse(section)).toEqual(section);
  }
});
