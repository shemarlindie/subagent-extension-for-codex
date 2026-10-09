import { expect, expectTypeOf, test } from "vitest";
import { z } from "zod";

import {
  budgetSettingRowSchema,
  helpPartSchema,
  modelScopeSchema,
  modelsSettingRowSchema,
  selectSettingRowSchema,
  settingOptionSchema,
  settingRowSchema,
  settingSectionSchema,
  switchSettingRowSchema,
  textSettingRowSchema,
} from "./document-contract.generated.js";
import type {
  BudgetSettingRow,
  HelpPart,
  ModelScope,
  ModelsSettingRow,
  SelectSettingRow,
  SettingOption,
  SettingRow,
  SettingSection,
  SwitchSettingRow,
  TextSettingRow,
} from "./document-contract.js";
import { settingsSections } from "./settings-document.js";

const option = { value: "default", label: "Inherit" };

const scope: ModelScope = {
  label: "Global",
  model: { key: "default_model", label: "Global model" },
  effort: {
    key: "default_reasoning_effort",
    label: "Global reasoning effort",
    options: [option],
    unsupported: false,
  },
};

const rows: SettingRow[] = [
  { kind: "select", key: "provider", label: "Provider", options: [option] },
  { kind: "switch", key: "enabled", label: "Enabled" },
  {
    kind: "text",
    key: "prefix",
    label: "Prefix",
    maxLength: 100,
    pattern: "[\\w./-]*",
  },
  {
    kind: "budget",
    key: "max_cost_usd",
    label: "Cost limit",
    toggle: "use_cost_budget",
    unit: "USD",
    min: 0.01,
    max: 100,
    amount: 5,
  },
  { kind: "models", scopes: [scope] },
];

test("generated output types match all public settings contracts", () => {
  expectTypeOf<z.output<typeof helpPartSchema>>().toEqualTypeOf<HelpPart>();

  expectTypeOf<
    z.output<typeof settingOptionSchema>
  >().toEqualTypeOf<SettingOption>();

  expectTypeOf<z.output<typeof modelScopeSchema>>().toEqualTypeOf<ModelScope>();

  expectTypeOf<z.output<typeof settingRowSchema>>().toEqualTypeOf<SettingRow>();

  expectTypeOf<
    z.output<typeof selectSettingRowSchema>
  >().toEqualTypeOf<SelectSettingRow>();

  expectTypeOf<
    z.output<typeof switchSettingRowSchema>
  >().toEqualTypeOf<SwitchSettingRow>();

  expectTypeOf<
    z.output<typeof textSettingRowSchema>
  >().toEqualTypeOf<TextSettingRow>();

  expectTypeOf<
    z.output<typeof budgetSettingRowSchema>
  >().toEqualTypeOf<BudgetSettingRow>();

  expectTypeOf<
    z.output<typeof modelsSettingRowSchema>
  >().toEqualTypeOf<ModelsSettingRow>();

  expectTypeOf<
    z.output<typeof settingSectionSchema>
  >().toEqualTypeOf<SettingSection>();
});

test.each(rows)("accepts a $kind setting row", (row) => {
  expect(settingRowSchema.parse(row)).toEqual(row);
});

test.each([
  { kind: "select", key: "provider", label: "Provider" },
  { kind: "models" },
  {
    kind: "models",
    scopes: [{ ...scope, effort: { ...scope.effort, options: undefined } }],
  },
  {
    kind: "text",
    key: "prefix",
    label: "Prefix",
    maxLength: "100",
    pattern: "",
  },
  {
    kind: "budget",
    key: "cost",
    label: "Cost",
    toggle: "enabled",
    unit: "USD",
    min: 0,
    max: 100,
    amount: false,
  },
  { kind: "switch", key: 1, label: "Enabled" },
  { kind: "unknown", key: "unknown", label: "Unknown" },
])("rejects malformed setting rows: %j", (row) => {
  expect(settingRowSchema.safeParse(row).success).toBe(false);
});

test("strips unknown fields throughout the settings document", () => {
  const help = { text: "Global", setting: "default_model" };

  const section: SettingSection = {
    id: "models",
    title: "Model defaults",
    help: ["Use ", help],
    rows: [
      {
        kind: "select",
        key: "provider",
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
  const sections = settingsSections({
    values: { default_provider: "claude", default_worker_profile: "worker" },
    providers: ["claude"],
    catalogs: [],
    shown: {},
    remembered: { max_cost_usd: 5, max_runtime_minutes: 15 },
  });

  expect(sections.length).toBeGreaterThan(0);

  for (const section of sections) {
    expect(settingSectionSchema.parse(section)).toEqual(section);
  }
});
