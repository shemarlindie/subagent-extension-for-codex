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
export const settingsUpdateSchema = z.strictObject({
  set: valuesSchema
    .partial()
    .refine((v) => Object.keys(v).length > 0, "Set at least one setting"),
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
  values(owner: string): SettingsValues {
    const row = this.store.db
      .prepare("SELECT body FROM user_settings WHERE owner=?")
      .get(owner);
    return valuesSchema.parse(
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
  read(owner: string) {
    const schema = z.toJSONSchema(valuesSchema);
    // Defaults are effective values, never JSON Schema defaults.
    return OpenAISettingsReadResultSchema.parse({
      schema,
      layout: [
        {
          kind: "group",
          title: "Delegation defaults",
          items: Object.keys(valuesSchema.shape).map((property) => ({
            kind: "property",
            property,
          })),
        },
      ],
      values: this.values(owner),
    });
  }
  update(owner: string, input: unknown) {
    const { set } = settingsUpdateSchema.parse(input);
    if (
      set.default_provider &&
      !this.providers().includes(set.default_provider)
    )
      throw new Error("Provider is not enabled");
    // Synchronous read/merge/write preserves omitted fields across concurrent requests.
    const values = valuesSchema.parse({ ...this.values(owner), ...set });
    this.store.db
      .prepare(
        "INSERT INTO user_settings VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET body=excluded.body",
      )
      .run(owner, JSON.stringify(values));
    return { values };
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
