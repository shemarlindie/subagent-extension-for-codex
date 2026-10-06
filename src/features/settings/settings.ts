import { z } from "zod";

import {
  approvalModeSchema,
  type InputAuthority,
  type ModelChoice,
  modelNameSchema,
  reasoningSchema,
  roles,
} from "../../shared/contracts.js";
import {
  approvalDecider,
  approvalDeciderSchema,
  claudeEnvironmentSchema,
  claudeOverrideDefaults,
  type ClaudeOverrides,
  claudePathGuardSchema,
  claudeSandboxSchema,
  claudeToolsSchema,
  legacyClaudeMode,
  permissionModeSchema,
} from "../tasks/policy/permissions.js";
import { type Store } from "../tasks/store.js";
import {
  modelScope,
  sectionSchema,
  settingHelp,
  settingsSections,
  unsupportedEffortWarning,
} from "./settings-document.js";

// Codex defaults are not supported yet; settings cover these providers only.
const settingsProviders = ["claude", "fixture"] as const;

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
  claude_permission_mode: permissionModeSchema.meta({
    title: "Claude permission mode",
    description: settingHelp.claude_permission_mode,
  }),
  // Restriction titles drop "Claude": their settings group already names it.
  claude_sandbox: claudeSandboxSchema.meta({
    title: "Bash sandbox",
    description: settingHelp.claude_sandbox,
  }),
  claude_environment: claudeEnvironmentSchema.meta({
    title: "Environment",
    description: settingHelp.claude_environment,
  }),
  claude_tools: claudeToolsSchema.meta({
    title: "Tools",
    description: settingHelp.claude_tools,
  }),
  claude_path_guard: claudePathGuardSchema.meta({
    title: "Workspace path guard",
    description: settingHelp.claude_path_guard,
  }),
  claude_subagents: z.boolean().meta({
    title: "Allow subagents",
    description: settingHelp.claude_subagents,
  }),
  default_approval_decider: approvalDeciderSchema.meta({
    title: "Approval decision maker",
    description: settingHelp.default_approval_decider,
  }),
  default_approval_mode: approvalModeSchema.meta({
    title: "Approval mode",
    description:
      "Ask user, delegate decisions to the parent agent, auto-approve within the sandbox, or deny execution requests. Read-only profiles and sandbox limits remain enforced.",
  }),
  default_provider: z.enum(settingsProviders).meta({ title: "Provider" }),
  default_worker_profile: z.enum(roles).meta({ title: "Worker profile" }),
  default_workspace_strategy: z
    .enum(["worktree", "current_repo"])
    .meta({ title: "Workspace" }),
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

// Fill missing fields in older settings rows without adding JSON Schema defaults to panel fields.
const storedValuesSchema = valuesSchema.extend({
  auto_register_chat_project: z.boolean().default(true),
  claude_permission_mode: permissionModeSchema.default("inherit"),
  default_approval_decider: approvalDeciderSchema.default("user"),
  claude_sandbox: claudeSandboxSchema.default(
    claudeOverrideDefaults.claude_sandbox,
  ),
  claude_environment: claudeEnvironmentSchema.default(
    claudeOverrideDefaults.claude_environment,
  ),
  claude_tools: claudeToolsSchema.default(claudeOverrideDefaults.claude_tools),
  claude_path_guard: claudePathGuardSchema.default(
    claudeOverrideDefaults.claude_path_guard,
  ),
  claude_subagents: z
    .boolean()
    .default(claudeOverrideDefaults.claude_subagents),
  default_approval_mode: approvalModeSchema.default("ask_user"),
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
    private store: Store,
    providers: () => string[],
  ) {
    // A Codex-only service still needs a valid provider default; tasks can
    // still choose Codex explicitly.
    this.providers = () => {
      const enabled = providers().filter((provider) =>
        settingsProviders.some((supported) => supported === provider),
      );

      return enabled.length ? enabled : ["claude"];
    };

    store.db.exec(
      "CREATE TABLE IF NOT EXISTS user_settings(owner TEXT PRIMARY KEY, body TEXT NOT NULL)",
    );
  }

  // A new user's settings; schema defaults fill in the rest.
  private initialBody() {
    return {
      default_provider: this.providers().includes("claude")
        ? "claude"
        : this.providers()[0],
      default_worker_profile: "reviewer",
      default_workspace_strategy: "current_repo",
      max_runtime_minutes: 20,
      max_cost_usd: 5,
    };
  }

  private saved(owner: string) {
    const row = this.store.db
      .prepare("SELECT body FROM user_settings WHERE owner=?")
      .get(owner);

    const body = row ? JSON.parse(String(row.body)) : this.initialBody();

    // Ignore Codex defaults saved before they were removed.
    delete body.codex_default_model;
    delete body.codex_default_reasoning_effort;
    if (body.default_provider === "codex")
      body.default_provider = this.providers()[0];
    if (
      body.claude_permission_mode === undefined &&
      body.default_approval_mode &&
      body.default_approval_mode !== "ask_user"
    )
      body.claude_permission_mode =
        legacyClaudeMode(body.default_approval_mode) ?? "inherit";
    if (
      body.default_approval_decider === undefined &&
      body.default_approval_mode === "parent_agent"
    )
      body.default_approval_decider = "parent_agent";

    return storedValuesSchema.parse(body);
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

  // Values as the panel and agents read them: without the retired approval
  // mode or a disabled provider's model defaults.
  private panelValues(values: SettingsValues) {
    const { default_approval_mode, ...visible } = values;
    const panel: z.infer<typeof panelValuesSchema> = visible;

    for (const key of this.hiddenModelKeys()) delete panel[key];

    return panel;
  }

  /** The values a new user starts with, which resets restore. */
  defaults() {
    const { cost_budget_amount, runtime_budget_amount, ...values } =
      storedValuesSchema.parse(this.initialBody());

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

    const scopes = { values, providers, catalogs };

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

    for (const scope of ["global", ...providers, ...roles]) {
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
    if (
      authority !== "user" &&
      (set.default_approval_mode !== undefined ||
        set.claude_permission_mode !== undefined ||
        set.default_approval_decider !== undefined)
    )
      throw new Error("Approval settings require a user decision in settings");
    if (
      authority !== "user" &&
      Object.keys(claudeOverrideDefaults).some(
        (key) => set[key as keyof ClaudeOverrides] !== undefined,
      )
    )
      throw new Error(
        "Claude session restrictions require a user decision in settings",
      );
    if (
      set.default_provider &&
      !this.providers().includes(set.default_provider)
    )
      throw new Error("Provider is not enabled");
    // Synchronous read/merge/write preserves omitted fields across concurrent requests.
    const previous = this.saved(owner);
    const { use_cost_budget, use_runtime_budget, ...fields } = set;

    // Older clients can still send the retired policy setting. Translate explicit
    // updates without overriding a native mode supplied in the same request.
    if (fields.default_approval_mode !== undefined) {
      fields.claude_permission_mode ??=
        legacyClaudeMode(fields.default_approval_mode) ?? "inherit";

      fields.default_approval_decider ??=
        fields.default_approval_mode === "parent_agent"
          ? "parent_agent"
          : "user";
    }

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

    const values = storedValuesSchema.parse({
      ...previous,
      ...fields,
      max_cost_usd,
      cost_budget_amount: amount,
      max_runtime_minutes,
      runtime_budget_amount: runtimeAmountValue,
    });

    this.store.db
      .prepare(
        "INSERT INTO user_settings VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET body=excluded.body",
      )
      .run(owner, JSON.stringify(values));

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
      model: typeof model === "string" ? model.trim() : undefined,
      reasoning_effort: reasoning,
      permission_mode:
        args.permission_mode ??
        (provider === "claude" && args.approval_mode !== undefined
          ? legacyClaudeMode(String(args.approval_mode))
          : undefined) ??
        "inherit",
      approval_decider:
        args.approval_decider ??
        (args.approval_mode !== undefined
          ? approvalDecider({ approval_mode: String(args.approval_mode) })
          : defaults.default_approval_decider),
      approval_mode: args.approval_mode ?? defaults.default_approval_mode,
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
