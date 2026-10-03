import { z } from "zod";
import {
  OpenAISettingsReadResultSchema,
  OPENAI_SETTINGS_CAPABILITY_KEY,
} from "@openai/mcp-extensions/server";
import {
  roles,
  modelNameSchema,
  reasoningSchema,
  type ModelChoice,
} from "./model.js";
import { type Store } from "./store.js";

// Codex defaults are not supported yet; settings cover these providers only.
const settingsProviders = ["claude", "fixture"] as const;
const scopeTitle = (scope: string) =>
  scope[0].toUpperCase() + scope.slice(1).replaceAll("_", " ");
import { globalPanelToolName } from "./panel.js";

export const settingsCapability = {
  [OPENAI_SETTINGS_CAPABILITY_KEY]: {
    readTool: "get_agent_settings",
    updateTool: "update_agent_settings",
  },
};
// Hosts on MCP 2025-11-25 or earlier may read only the legacy location.
export function withSettingsCapability(capabilities: {
  experimental?: Record<string, object>;
}) {
  return {
    ...capabilities,
    experimental: { ...capabilities.experimental, ...settingsCapability },
    extensions: settingsCapability,
  };
}
// Native settings support only inclusive bounds. These sit just above the
// server's exclusive zero bounds, so fractional saved values stay valid.
const hostMinimums = { max_runtime_minutes: 0.01, max_cost_usd: 0.01 };
// Scalar properties keep the native settings editor compatible with the host.
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
  default_provider: z
    .enum(settingsProviders)
    .meta({ title: "Default provider" }),
  default_worker_profile: z
    .enum(roles)
    .meta({ title: "Default worker profile" }),
  default_workspace_strategy: z
    .enum(["worktree", "current_repo"])
    .meta({ title: "Workspace strategy" }),
  max_runtime_minutes: z
    .number()
    .positive()
    .max(120)
    .meta({ title: "Default runtime budget (minutes)" }),
  max_cost_usd: z
    .number()
    .positive()
    .max(100)
    .nullable()
    .meta({ title: "Default cost budget (USD; null means no limit)" }),
});
const costAmount = z
  .number()
  .positive()
  .max(100)
  .meta({ title: "Default cost budget (USD)" });
const hostValuesSchema = valuesSchema.extend({
  max_cost_usd: costAmount,
  use_cost_budget: z.boolean().meta({ title: "Apply a default cost limit" }),
});
// Fill missing fields in older settings rows without adding JSON Schema defaults to host fields.
const storedValuesSchema = valuesSchema.extend({
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
});
// Use this project's Zod instance for transport schemas; the extension SDK may
// install a different Zod version. Validate layout with its schema when reading.
export const settingsReadOutputSchema = z.object({
  schema: z.looseObject({
    type: z.literal("object"),
    properties: z
      .record(
        z.string(),
        z.looseObject({
          type: z.enum(["boolean", "string", "number", "integer"]),
        }),
      )
      .optional(),
    required: z.array(z.string()).optional(),
  }),
  layout: z.array(z.record(z.string(), z.unknown())).optional(),
  values: hostValuesSchema,
});
export const settingsUpdateOutputSchema = z.object({
  values: hostValuesSchema,
});
export const settingsUpdateSchema = z.strictObject({
  set: valuesSchema
    .extend({ use_cost_budget: z.boolean() })
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
  private saved(owner: string) {
    const row = this.store.db
      .prepare("SELECT body FROM user_settings WHERE owner=?")
      .get(owner);
    const body = row
      ? JSON.parse(String(row.body))
      : {
          default_provider: this.providers().includes("claude")
            ? "claude"
            : this.providers()[0],
          default_worker_profile: "reviewer",
          default_workspace_strategy: "current_repo",
          max_runtime_minutes: 20,
          max_cost_usd: 5,
        };
    // Ignore Codex defaults saved before they were removed.
    delete body.codex_default_model;
    delete body.codex_default_reasoning_effort;
    if (body.default_provider === "codex")
      body.default_provider = this.providers()[0];
    return storedValuesSchema.parse(body);
  }
  values(owner: string): SettingsValues {
    const { cost_budget_amount, ...values } = this.saved(owner);
    const available = this.providers();
    // A saved provider can disappear when the service configuration changes.
    if (!available.includes(values.default_provider))
      values.default_provider = valuesSchema.shape.default_provider.parse(
        available[0],
      );
    return values;
  }
  private hostValues(owner: string) {
    const { cost_budget_amount, ...values } = this.saved(owner);
    return {
      ...this.values(owner),
      use_cost_budget: values.max_cost_usd !== null,
      max_cost_usd: values.max_cost_usd ?? cost_budget_amount ?? 5,
    };
  }
  read(
    owner: string,
    catalogs: { provider: string; models?: ModelChoice[] }[] = [],
  ) {
    const schema = z.toJSONSchema(
      hostValuesSchema.extend({
        default_provider: z
          .enum(this.providers() as [string, ...string[]])
          .meta({ title: "Default provider" }),
      }),
    );
    catalogs = catalogs.filter((catalog) =>
      this.providers().includes(catalog.provider),
    );
    const values = this.hostValues(owner);
    const fields = values as Record<string, unknown>;
    const properties = schema.properties!;
    for (const [key, minimum] of Object.entries(hostMinimums)) {
      const field = properties[key] as Record<string, unknown>;
      delete field.exclusiveMinimum;
      field.minimum = minimum;
    }
    const scopes = ["global", ...this.providers(), ...roles];
    for (const scope of scopes) {
      const prefix = scope === "global" ? "default" : `${scope}_default`;
      const modelKey = `${prefix}_model`;
      const effortKey = `${prefix}_reasoning_effort`;
      const providerScope = this.providers().includes(scope);
      const choices = catalogs
        .filter((catalog) => !providerScope || catalog.provider === scope)
        .flatMap((catalog) => catalog.models ?? []);
      const modelField = properties[modelKey] as Record<string, unknown>;
      modelField.description =
        "Blank inherits the next default: role → provider → global → provider runtime. Saved custom model IDs remain available.";
      if (choices.length)
        modelField.enum = [
          ...new Set([
            "",
            ...choices.map((model) => model.value),
            String(fields[modelKey]),
          ]),
        ];
      const provider = providerScope ? scope : values.default_provider;
      const effectiveModel = String(
        fields[modelKey] ||
          (scope !== "global" && !providerScope
            ? fields[`${provider}_default_model`]
            : "") ||
          (scope !== "global" ? values.default_model : "") ||
          "default",
      );
      const metadata = catalogs
        .find((catalog) => catalog.provider === provider)
        ?.models?.find((model) => model.value === effectiveModel);
      const effortField = properties[effortKey] as Record<string, unknown>;
      const levels =
        metadata?.supportsEffort === false
          ? []
          : metadata?.supportedEffortLevels;
      effortField.description = `Default inherits the next configured reasoning setting. ${
        levels === undefined
          ? "Model-specific effort support is unknown; the provider validates it when work starts."
          : `Supported efforts for ${provider} model ${effectiveModel}: ${levels.length ? levels.join(", ") : "provider runtime default only"}.`
      } ${!providerScope ? "This default applies across providers; validate it against the provider used for each task." : ""} ${
        levels !== undefined &&
        fields[effortKey] !== "default" &&
        !levels.some((level) => level === fields[effortKey])
          ? "The saved effort is not supported by this model; choose another effort or model."
          : ""
      }`;
      // Global and role choices apply across providers; only provider fields have a fixed catalog.
      // Preserve saved values in the schema even if the runtime catalog has changed.
      if (providerScope && levels !== undefined)
        effortField.enum = [
          ...new Set(["default", ...levels, String(fields[effortKey])]),
        ];
    }
    // Defaults are effective values, never JSON Schema defaults.
    return settingsReadOutputSchema.parse(
      OpenAISettingsReadResultSchema.parse({
        schema,
        layout: [
          {
            kind: "group",
            title: "Delegation defaults",
            items: [
              ...[
                "default_provider",
                "default_worker_profile",
                "default_workspace_strategy",
                "max_runtime_minutes",
                "use_cost_budget",
                "max_cost_usd",
              ].map((property) => ({ kind: "property", property })),
              {
                kind: "tool",
                tool: globalPanelToolName,
                title: "Open delegated work",
                description:
                  "Review tasks across all projects and conversations.",
              },
            ],
          },
          {
            kind: "group",
            title: "Global model defaults",
            items: ["default_model", "default_reasoning_effort"].map(
              (property) => ({ kind: "property", property }),
            ),
          },
          ...[...settingsProviders, ...roles].map((scope) => ({
            kind: "group",
            title: `${scopeTitle(scope)} defaults`,
            items: [
              `${scope}_default_model`,
              `${scope}_default_reasoning_effort`,
            ].map((property) => ({ kind: "property", property })),
          })),
        ],
        values,
      }),
    );
  }
  update(owner: string, input: unknown) {
    const { set } = settingsUpdateSchema.parse(input);
    if (
      set.default_provider &&
      !this.providers().includes(set.default_provider)
    )
      throw new Error("Provider is not enabled");
    // Synchronous read/merge/write preserves omitted fields across concurrent requests.
    const previous = this.saved(owner);
    const { use_cost_budget, ...fields } = set;
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
    const values = storedValuesSchema.parse({
      ...previous,
      ...fields,
      max_cost_usd,
      cost_budget_amount: amount,
    });
    this.store.db
      .prepare(
        "INSERT INTO user_settings VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET body=excluded.body",
      )
      .run(owner, JSON.stringify(values));
    return { values: this.hostValues(owner) };
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
