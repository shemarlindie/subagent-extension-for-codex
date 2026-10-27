/**
 * The settings' Zod schemas: the values a user can set, how they are stored
 * and first defaulted, and the read and update contracts of the settings tools.
 */
import { z } from "zod";

import {
  providerModelSettingScopes,
  providerSettingsShape,
  providerStoredSettingsShape,
} from "../../../shared/providers/settings.js";
import {
  branchPrefixPattern,
  sectionSchema,
  settingHelp,
  titleCase,
} from "../../../shared/settings/settings-document.js";
import {
  approvalDeciderSchema,
  approvalModeSchema,
  modelNameSchema,
  reasoningSchema,
  roles,
} from "../../../shared/tasks/model.js";

// Settings cover these providers only.
export const settingsProviders = providerModelSettingScopes;

export const modelSettingsShape = {
  default_model: modelNameSchema.meta({
    title: "Default model",
  }),
  default_reasoning_effort: reasoningSchema.meta({
    title: "Reasoning effort",
  }),
  ...(Object.fromEntries(
    [...settingsProviders, ...roles].flatMap((scope) => [
      [
        `${scope}_default_model`,
        modelNameSchema.meta({
          title: `${titleCase(scope)} model`,
        }),
      ],
      [
        `${scope}_default_reasoning_effort`,
        reasoningSchema.meta({
          title: `${titleCase(scope)} reasoning effort`,
        }),
      ],
    ]),
  ) as {
    [
      K in `${(typeof settingsProviders)[number] | (typeof roles)[number]}_default_model`
    ]: typeof modelNameSchema;
  } & {
    [
      K in `${(typeof settingsProviders)[number] | (typeof roles)[number]}_default_reasoning_effort`
    ]: typeof reasoningSchema;
  }),
};

export const valuesSchema = z.strictObject({
  ...modelSettingsShape,
  auto_register_chat_project: z.boolean().meta({
    title: "Automatically add chat projects",
    description: settingHelp.auto_register_chat_project,
  }),
  ...providerSettingsShape,
  default_approval_decider: approvalDeciderSchema.meta({
    title: "Approval decision maker",
    description: settingHelp.default_approval_decider,
  }),
  default_approval_mode: approvalModeSchema.meta({
    title: "Execution approval mode",
    description:
      "Default for execution providers: ask user, delegate to the parent agent, auto-approve within the sandbox, or deny execution requests. Native permission settings are independent. Read-only profiles and sandbox limits remain enforced.",
  }),
  default_provider: z.string().min(1).meta({ title: "Provider" }),
  default_worker_profile: z.enum(roles).meta({ title: "Worker profile" }),
  default_workspace_strategy: z
    .enum(["worktree", "current_repo"])
    .meta({ title: "Workspace" }),
  // Git checks the whole name when a worktree is created.
  worktree_branch_prefix: z
    .string()
    .max(100)
    .regex(
      new RegExp(`^${branchPrefixPattern}$`),
      "Use letters, digits, '.', '_', '-' and '/'",
    )
    .meta({
      title: "Worktree branch prefix",
      description: settingHelp.worktree_branch_prefix,
    }),
  max_runtime_minutes: z.number().positive().nullable().meta({
    title: "Runtime limit (minutes; null means no limit)",
  }),
  max_cost_usd: z
    .number()
    .positive()
    .nullable()
    .meta({ title: "Cost limit (USD; null means no limit)" }),
});

const costAmount = z.number().positive().meta({ title: "Cost limit (USD)" });

const runtimeAmount = z
  .number()
  .positive()
  .meta({ title: "Runtime limit (minutes)" });

type ProviderModelKey =
  | `${(typeof settingsProviders)[number]}_default_model`
  | `${(typeof settingsProviders)[number]}_default_reasoning_effort`;

export const providerModelKeys = settingsProviders.flatMap((scope) => [
  `${scope}_default_model` as const,
  `${scope}_default_reasoning_effort` as const,
]);

// Budgets read as a number or null (no limit); updates may still use the
// `use_*_budget` switches, which keep the amount while a limit is off.
export const panelValuesSchema = valuesSchema
  .omit({ default_approval_mode: true })
  // The panel omits a disabled provider's model defaults (see `hiddenModelKeys`).
  .partial(
    Object.fromEntries(providerModelKeys.map((key) => [key, true])) as Record<
      ProviderModelKey,
      true
    >,
  );

export const initialValuesSchema = valuesSchema.extend({
  auto_register_chat_project: z.boolean().default(true),
  ...providerStoredSettingsShape,
  default_approval_decider: approvalDeciderSchema.default("user"),
  default_approval_mode: approvalModeSchema.default("ask_user"),
  worktree_branch_prefix:
    valuesSchema.shape.worktree_branch_prefix.default("agent/"),
  ...(Object.fromEntries(
    Object.entries(modelSettingsShape).map(([key, schema]) => [
      key,
      key.endsWith("_model")
        ? (schema as typeof modelNameSchema).default("")
        : (schema as typeof reasoningSchema).default("default"),
    ]),
  ) as {
    [K in keyof typeof modelSettingsShape]: z.ZodDefault<
      (typeof modelSettingsShape)[K]
    >;
  }),
  cost_budget_amount: costAmount.optional(),
  runtime_budget_amount: runtimeAmount.optional(),
});

export const persistedValuesSchema = valuesSchema.extend({
  cost_budget_amount: costAmount.optional(),
  runtime_budget_amount: runtimeAmount.optional(),
});

// The panel's settings document: field schemas, values, and the groups the
// settings dialog shows, each with a stable ID.
export const settingsReadOutputSchema = z.object({
  // Field types, choices, and bounds; agents read this to update settings.
  schema: z.looseObject({
    type: z.literal("object"),
    properties: z.record(z.string(), z.looseObject({})).optional(),
    required: z.array(z.string()).optional(),
  }),
  values: panelValuesSchema,
  // What each shown setting resets to.
  defaults: panelValuesSchema,
  // What the settings dialog shows, section by section.
  sections: z.array(sectionSchema),
});

export const settingsUpdateOutputSchema = z.object({
  values: panelValuesSchema,
});

export const settingsUpdateSchema = z.strictObject({
  set: valuesSchema
    .extend({ use_cost_budget: z.boolean(), use_runtime_budget: z.boolean() })
    .partial()
    .refine((v) => Object.keys(v).length > 0, "Set at least one setting")
    .meta({ minProperties: 1 }),
});

export type SettingsValues = z.infer<typeof valuesSchema>;
