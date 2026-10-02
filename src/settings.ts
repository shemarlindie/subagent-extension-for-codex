import { z } from "zod";
import {
  OpenAISettingsReadResultSchema,
  OPENAI_SETTINGS_CAPABILITY_KEY,
} from "@openai/mcp-extensions/server";
import { roles } from "./model.js";
import { type Store } from "./store.js";

export const settingsCapability = {
  [OPENAI_SETTINGS_CAPABILITY_KEY]: {
    readTool: "get_agent_settings",
    updateTool: "update_agent_settings",
  },
};
const valuesSchema = z.strictObject({
  default_provider: z
    .enum(["claude", "codex", "fixture"])
    .meta({ title: "Default provider" }),
  default_worker_profile: z
    .enum(roles)
    .meta({ title: "Default worker profile" }),
  default_workspace_strategy: z
    .literal("worktree")
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
const storedValuesSchema = valuesSchema.extend({
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
  constructor(
    private store: Store,
    private providers: () => string[],
  ) {
    store.db.exec(
      "CREATE TABLE IF NOT EXISTS user_settings(owner TEXT PRIMARY KEY, body TEXT NOT NULL)",
    );
  }
  private saved(owner: string) {
    const row = this.store.db
      .prepare("SELECT body FROM user_settings WHERE owner=?")
      .get(owner);
    return storedValuesSchema.parse(
      row
        ? JSON.parse(String(row.body))
        : {
            default_provider: this.providers().includes("claude")
              ? "claude"
              : this.providers()[0],
            default_worker_profile: "reviewer",
            default_workspace_strategy: "worktree",
            max_runtime_minutes: 20,
            max_cost_usd: 5,
          },
    );
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
  read(owner: string) {
    const schema = z.toJSONSchema(
      hostValuesSchema.extend({
        default_provider: z
          .enum(this.providers() as [string, ...string[]])
          .meta({ title: "Default provider" }),
      }),
    );
    // Defaults are effective values, never JSON Schema defaults.
    return settingsReadOutputSchema.parse(
      OpenAISettingsReadResultSchema.parse({
        schema,
        layout: [
          {
            kind: "group",
            title: "Delegation defaults",
            items: Object.keys(hostValuesSchema.shape).map((property) => ({
              kind: "property",
              property,
            })),
          },
        ],
        values: this.hostValues(owner),
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
    const defaults = this.values(owner);
    return {
      ...args,
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
