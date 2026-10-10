import { eq } from "drizzle-orm";
import { z } from "zod";

import {
  builtinProviderMetadata,
  type ProviderMetadata,
} from "../../../shared/providers/metadata.js";
import {
  preferredSettingsProvider,
  providerModelSettingScopes,
  providerSettingsShape,
  providerStoredSettingsShape,
  validateProviderSettingsUpdate,
} from "../../../shared/providers/settings.js";
import { type ModelChoice } from "../../../shared/providers/types.js";
import {
  branchPrefixPattern,
  modelScope,
  sectionSchema,
  settingHelp,
  settingsSections,
  unsupportedEffortWarning,
} from "../../../shared/settings/settings-document.js";
import {
  approvalModeSchema,
  type InputAuthority,
  modelNameSchema,
  reasoningSchema,
  roles,
} from "../../../shared/tasks/model.js";
import { type Database } from "../../platform/database/database.js";
import { checkStored, decodeStored } from "../../platform/database/decode.js";
import { userSettings } from "./schema.js";

// Settings cover these providers only.
const settingsProviders = providerModelSettingScopes;

const scopeTitle = (scope: string) =>
  scope[0].toUpperCase() + scope.slice(1).replaceAll("_", " ");

const modelSettingsShape = {
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
          title: `${scopeTitle(scope)} model`,
        }),
      ],
      [
        `${scope}_default_reasoning_effort`,
        reasoningSchema.meta({
          title: `${scopeTitle(scope)} reasoning effort`,
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

const valuesSchema = z.strictObject({
  ...modelSettingsShape,
  auto_register_chat_project: z.boolean().meta({
    title: "Automatically add chat projects",
    description: settingHelp.auto_register_chat_project,
  }),
  ...providerSettingsShape,
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
  max_runtime_minutes: z.number().positive().max(120).nullable().meta({
    title: "Runtime limit (minutes; null means no limit)",
  }),
  max_cost_usd: z
    .number()
    .positive()
    .max(100)
    .nullable()
    .meta({ title: "Cost limit (USD; null means no limit)" }),
});

const costAmount = z
  .number()
  .positive()
  .max(100)
  .meta({ title: "Cost limit (USD)" });

const runtimeAmount = z
  .number()
  .positive()
  .max(120)
  .meta({ title: "Runtime limit (minutes)" });

type ProviderModelKey =
  | `${(typeof settingsProviders)[number]}_default_model`
  | `${(typeof settingsProviders)[number]}_default_reasoning_effort`;

const providerModelKeys = settingsProviders.flatMap((scope) => [
  `${scope}_default_model` as const,
  `${scope}_default_reasoning_effort` as const,
]);

// Budgets read as a number or null (no limit); updates may still use the
// `use_*_budget` switches, which keep the amount while a limit is off.
const panelValuesSchema = valuesSchema
  .omit({ default_approval_mode: true })
  // The panel omits a disabled provider's model defaults (see `hiddenModelKeys`).
  .partial(
    Object.fromEntries(providerModelKeys.map((key) => [key, true])) as Record<
      ProviderModelKey,
      true
    >,
  );

const initialValuesSchema = valuesSchema.extend({
  auto_register_chat_project: z.boolean().default(true),
  ...providerStoredSettingsShape,
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

const persistedValuesSchema = valuesSchema.extend({
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

export class Settings {
  private providers: () => string[];
  constructor(
    private database: Database,
    providers: () => string[],
    private metadata: (provider: string) => ProviderMetadata | undefined = (
      provider,
    ) => builtinProviderMetadata[provider],
  ) {
    // Settings cover providers with presentation metadata. A service without
    // any still needs a valid provider default; tasks can still choose other
    // providers explicitly.
    this.providers = () => {
      const enabled = providers().filter((provider) => this.metadata(provider));

      return enabled.length ? enabled : [providerModelSettingScopes[0]];
    };
  }

  // A new user's settings; schema defaults fill in the rest.
  private initialBody() {
    return {
      default_provider: preferredSettingsProvider(this.providers()),
      default_worker_profile: "reviewer",
      default_workspace_strategy: "current_repo",
      max_runtime_minutes: 20,
      max_cost_usd: 5,
    };
  }

  private saved(owner: string) {
    const row = this.database.orm
      .select({ body: userSettings.body })
      .from(userSettings)
      .where(eq(userSettings.owner, owner))
      .get();

    if (!row) return initialValuesSchema.parse(this.initialBody());

    const record = `settings for ${owner}`;
    const body = decodeStored(z.looseObject({}), row.body, record);

    // Older settings used `inherit` to defer permission mode to Claude Code.
    // The extension now owns this mode, so preserve those users with Default.
    if (body.claude_permission_mode === "inherit")
      body.claude_permission_mode = "default";

    if (!this.providers().includes(body.default_provider as string))
      body.default_provider = this.providers()[0];

    return checkStored(persistedValuesSchema, body, record);
  }

  values(owner: string): SettingsValues {
    const { cost_budget_amount, runtime_budget_amount, ...values } =
      this.saved(owner);

    const available = this.providers();
    // A saved provider can disappear when the service configuration changes.
    if (!available.includes(values.default_provider))
      values.default_provider = valuesSchema.shape.default_provider.parse(
        available[0],
      );

    return values;
  }

  // The panel presents native permission settings; execution approval defaults
  // remain available to execution providers and direct settings callers.
  private panelValues(values: SettingsValues) {
    const { default_approval_mode, ...visible } = values;
    const panel: z.infer<typeof panelValuesSchema> = visible;

    for (const key of this.hiddenModelKeys()) delete panel[key];

    return panel;
  }

  /** The values a new user starts with, which resets restore. */
  defaults() {
    const { cost_budget_amount, runtime_budget_amount, ...values } =
      initialValuesSchema.parse(this.initialBody());

    return values;
  }

  // A disabled provider's model defaults stay saved but hidden from the panel
  // until the provider is enabled again.
  private hiddenModelKeys() {
    return providerModelKeys.filter(
      (key) =>
        !this.providers().some((provider) => key.startsWith(`${provider}_`)),
    );
  }

  read(
    owner: string,
    catalogs: { provider: string; models?: ModelChoice[] }[] = [],
  ) {
    const providers = this.providers();

    const schema = z.toJSONSchema(
      panelValuesSchema.extend({
        default_provider: z
          .enum(providers as [string, ...string[]])
          .meta({ title: "Provider" }),
      }),
    );

    catalogs = catalogs.filter((catalog) =>
      providers.includes(catalog.provider),
    );

    const saved = this.saved(owner),
      values = this.panelValues(this.values(owner)),
      properties = schema.properties!;

    for (const key of this.hiddenModelKeys()) delete properties[key];

    const scopes = {
      values,
      providers,
      catalogs,
      modelProviders: providers.filter(
        (provider) => `${provider}_default_model` in properties,
      ),
    };

    const sections = settingsSections({
      ...scopes,
      shown: properties,
      remembered: {
        max_cost_usd: saved.max_cost_usd ?? saved.cost_budget_amount ?? 5,
        max_runtime_minutes:
          saved.max_runtime_minutes ?? saved.runtime_budget_amount ?? 20,
      },
    });

    // Agents read choices and notes from the schema; the panel reads sections,
    // whose intros explain the same chain from each section's side.
    const modelNote =
      "Blank inherits the next default: the task's worker profile, then its provider, then the global default, then the provider's own default. A model chosen for a task overrides these.";

    for (const scope of ["global", ...scopes.modelProviders, ...roles]) {
      const info = modelScope(scope, scopes),
        modelField = properties[info.modelKey] as Record<string, unknown>,
        effortField = properties[info.effortKey] as Record<string, unknown>;

      modelField.description = modelNote;
      if (info.modelChoices)
        modelField.enum = info.modelChoices.map((option) => option.value);
      effortField.enum = info.effortChoices.map((option) => option.value);

      effortField.description = [
        "Inherit uses the next level, like models.",
        info.levels === undefined
          ? "Effort support is unknown; the provider checks it when a task starts."
          : `Supported efforts for ${info.provider} model ${info.effectiveModel}: ${info.levels.length ? info.levels.join(", ") : "provider runtime default only"}.`,
        !info.providerScope && "Applies to every provider.",
        info.unsupported && unsupportedEffortWarning,
      ]
        .filter(Boolean)
        .join(" ");
    }

    // Defaults are effective values, never JSON Schema defaults.
    return settingsReadOutputSchema.parse({
      schema,
      values,
      defaults: this.panelValues(this.defaults()),
      sections,
    });
  }

  update(owner: string, input: unknown, authority: InputAuthority = "user") {
    const { set } = settingsUpdateSchema.parse(input);
    if (authority !== "user" && set.auto_register_chat_project !== undefined)
      throw new Error(
        "Automatic project registration requires a user decision in settings",
      );
    if (authority !== "user" && set.default_approval_mode !== undefined)
      throw new Error("Approval settings require a user decision in settings");
    validateProviderSettingsUpdate(set, authority);
    if (
      set.default_provider &&
      !this.providers().includes(set.default_provider)
    )
      throw new Error("Provider is not enabled");
    // Synchronous read/merge/write preserves omitted fields across concurrent requests.
    const previous = this.saved(owner);
    const { use_cost_budget, use_runtime_budget, ...fields } = set;

    const amount =
      fields.max_cost_usd ??
      previous.max_cost_usd ??
      previous.cost_budget_amount ??
      5;

    const max_cost_usd =
      use_cost_budget === undefined
        ? fields.max_cost_usd === undefined
          ? previous.max_cost_usd
          : fields.max_cost_usd === null || previous.max_cost_usd === null
            ? null
            : fields.max_cost_usd
        : use_cost_budget
          ? amount
          : null;

    const runtimeAmountValue =
      fields.max_runtime_minutes ??
      previous.max_runtime_minutes ??
      previous.runtime_budget_amount ??
      20;

    const max_runtime_minutes =
      use_runtime_budget === undefined
        ? fields.max_runtime_minutes === undefined
          ? previous.max_runtime_minutes
          : fields.max_runtime_minutes === null ||
              previous.max_runtime_minutes === null
            ? null
            : fields.max_runtime_minutes
        : use_runtime_budget
          ? runtimeAmountValue
          : null;

    const values = persistedValuesSchema.parse({
      ...previous,
      ...fields,
      max_cost_usd,
      cost_budget_amount: amount,
      max_runtime_minutes,
      runtime_budget_amount: runtimeAmountValue,
    });

    const body = JSON.stringify(values);

    this.database.orm
      .insert(userSettings)
      .values({ owner, body })
      .onConflictDoUpdate({ target: userSettings.owner, set: { body } })
      .run();

    return { values: this.panelValues(this.values(owner)) };
  }

  taskInput(owner: string, input: unknown) {
    const args = z.record(z.string(), z.unknown()).parse(input);
    if (args.model !== undefined)
      args.model = modelNameSchema.parse(args.model);
    if (args.reasoning_effort !== undefined)
      args.reasoning_effort = reasoningSchema.parse(args.reasoning_effort);
    const defaults = this.values(owner);
    const provider = args.provider ?? defaults.default_provider;
    const role = args.worker_profile ?? defaults.default_worker_profile;
    const fields = defaults as Record<string, unknown>;

    // Resolve each choice independently; inheritance sentinels leave the next scope in control.
    const model = [
      args.model,
      fields[`${role}_default_model`],
      fields[`${provider}_default_model`],
      defaults.default_model,
    ].find((value) => typeof value === "string" && value.trim());

    const reasoning = [
      args.reasoning_effort,
      fields[`${role}_default_reasoning_effort`],
      fields[`${provider}_default_reasoning_effort`],
      defaults.default_reasoning_effort,
    ].find((value) => value !== undefined && value !== "default");

    return {
      ...args,
      ...(args.provider_options
        ? { provider_options: args.provider_options }
        : {}),
      model: typeof model === "string" ? model.trim() : undefined,
      reasoning_effort: reasoning,
      ...(args.approval_mode !== undefined
        ? { approval_mode: args.approval_mode }
        : {}),
      provider: args.provider ?? defaults.default_provider,
      worker_profile: args.worker_profile ?? defaults.default_worker_profile,
      workspace_strategy:
        args.workspace_strategy ?? defaults.default_workspace_strategy,
      budget: {
        max_runtime_minutes: defaults.max_runtime_minutes,
        max_cost_usd: defaults.max_cost_usd,
        ...z.record(z.string(), z.unknown()).parse(args.budget ?? {}),
      },
    };
  }
}
