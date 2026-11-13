/**
 * The settings, defined once: each leaf's type, default, title, help and
 * authority. The service stores and validates these values, the settings
 * document reads labels from them, and agents read their JSON Schema.
 */
import { z } from "zod";

import {
  providerModelSettingScopes,
  providerSettingsSchemas,
} from "../providers/settings.js";
import {
  approvalDeciderSchema,
  approvalModeSchema,
  modelNameSchema,
  reasoningSchema,
  roles,
} from "../tasks/model.js";
import { titleCase } from "../text.js";
import { settingMeta, unwrapped } from "./setting-text.js";

/** Characters a branch prefix may use; Git checks the whole branch name. */
export const branchPrefixPattern = "[\\w./-]*";

/**
 * Plain help shared by a setting's row and its schema description, so agents
 * and the panel read the same text. Options are named by their display labels.
 */
export const settingHelp = {
  auto_register_chat:
    "When a chat starts a task, register the chat's local Git root from host directory metadata, never from task paths. Turning this off keeps projects already registered.",
  decider:
    "Who answers permission requests that a provider's own checks don't decide.",
  worktree_branch_prefix:
    "Each worktree task works on its own branch, named this prefix followed by the task ID.",
  profile_instructions:
    "Added to the system prompt of new tasks that use this profile.",
};

/** The longest custom instructions a worker profile can carry. */
export const profileInstructionsMaxLength = 4000;

// A limit keeps its amount while it's off, so turning it on restores it.
const budget = (
  title: string,
  unit: string,
  amount: number,
  keywords: string[],
) =>
  z
    .strictObject({
      enabled: z
        .boolean()
        .meta({ title: `${title} on` })
        .default(false),
      amount: z
        .number()
        .positive()
        .meta({ title: `${title} (${unit})` })
        .default(amount),
    })
    .meta({ title, keywords })
    .prefault({});

const modelScope = (label: string) =>
  z
    .strictObject({
      model: modelNameSchema.meta({ title: `${label} model` }).default(""),
      reasoning_effort: reasoningSchema
        .meta({ title: `${label} reasoning` })
        .default("default"),
    })
    .prefault({});

const scopes = <T extends string>(ids: readonly T[]) =>
  z.strictObject(
    Object.fromEntries(
      ids.map((id) => [id, modelScope(titleCase(id))]),
    ) as Record<T, ReturnType<typeof modelScope>>,
  );

const profileSettings = (label: string) =>
  z
    .strictObject({
      instructions: z
        .string()
        .max(profileInstructionsMaxLength)
        .meta({
          title: `${label} custom instructions`,
          description: settingHelp.profile_instructions,
        })
        .default(""),
    })
    .prefault({});

// `userOnly` subtrees change only with the user's authority.
export const settingsSchema = z.strictObject({
  // Defaults for `start_task`, under its field names.
  task: z.strictObject({
    // Has no static default: see `settingsDefaults`. Updates must name an
    // enabled provider, and reads replace one that's no longer enabled.
    provider: z.string().meta({ title: "Provider" }),
    worker_profile: z
      .enum(roles)
      .meta({ title: "Worker profile" })
      .default("implementer"),
    workspace_strategy: z
      .enum(["worktree", "current_repo"])
      .meta({
        title: "Workspace",
        description:
          "A project with no Git commit always uses the project folder, because worktrees need a commit.",
      })
      .default("current_repo"),
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
      })
      .default("agent/"),
    budget: z
      .strictObject({
        max_cost_usd: budget("Cost limit", "USD", 5, [
          "spending",
          "price",
          "cost budget",
        ]),
        max_runtime_minutes: budget("Runtime limit", "minutes", 20, [
          "timeout",
          "time limit",
          "duration",
        ]),
      })
      .prefault({}),
  }),
  models: z
    .strictObject({
      global: modelScope("Global"),
      providers: scopes(providerModelSettingScopes).prefault({}),
      profiles: scopes(roles).prefault({}),
    })
    .prefault({}),
  // Instructions steer future workers, so only the user changes them.
  profiles: z
    .strictObject(
      Object.fromEntries(
        roles.map((role) => [role, profileSettings(titleCase(role))]),
      ) as Record<(typeof roles)[number], ReturnType<typeof profileSettings>>,
    )
    .meta({ userOnly: true })
    .prefault({}),
  approvals: z
    .strictObject({
      decider: approvalDeciderSchema
        .meta({
          title: "Approval decision maker",
          description: settingHelp.decider,
        })
        .default("user"),
      execution_mode: approvalModeSchema
        .meta({
          title: "Execution approval mode",
          description:
            "Default for execution providers: ask user, delegate to the parent agent, auto-approve within the sandbox, or deny execution requests. Native permission settings are independent.",
        })
        .default("ask_user"),
    })
    .meta({ userOnly: true })
    .prefault({}),
  projects: z
    .strictObject({
      auto_register_chat: z
        .boolean()
        .meta({
          title: "Automatically add chat projects",
          description: settingHelp.auto_register_chat,
        })
        .default(true),
    })
    .meta({ userOnly: true })
    .prefault({}),
  providers: z
    .strictObject(providerSettingsSchemas)
    .meta({ userOnly: true })
    .prefault({}),
});

export type SettingsValues = z.infer<typeof settingsSchema>;

/** A new user's settings, with the given default provider. */
export const settingsDefaults = (provider: string): SettingsValues =>
  settingsSchema.parse({ task: { provider } });

/** A dotted path's value in nested settings, or undefined. */
export function settingAt(values: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (value, key) =>
        value !== null && typeof value === "object"
          ? (value as Record<string, unknown>)[key]
          : undefined,
      values,
    );
}

/** The schema at a dotted path, or undefined when the path isn't a setting. */
export function settingSchemaAt(path: string): z.ZodType | undefined {
  let current: z.ZodType | undefined = settingsSchema;

  for (const key of path.split(".")) {
    const object = current && unwrapped(current);
    if (!(object instanceof z.ZodObject)) return undefined;
    const shape = object.shape as Record<string, z.ZodType>;
    current = Object.hasOwn(shape, key) ? shape[key] : undefined;
  }

  return current;
}

/** Whether a path, or any group holding it, is marked user-only. */
export function userOnlySetting(path: string) {
  const keys = path.split(".");

  return keys.some((_, index) => {
    const schema = settingSchemaAt(keys.slice(0, index + 1).join("."));

    return schema !== undefined && settingMeta(schema).userOnly === true;
  });
}

/** Every leaf path present in nested values, in order. */
export function settingPaths(values: unknown, prefix = ""): string[] {
  if (values === null || typeof values !== "object" || Array.isArray(values)) {
    return prefix ? [prefix] : [];
  }

  return Object.entries(values).flatMap(([key, value]) =>
    settingPaths(value, prefix ? `${prefix}.${key}` : key),
  );
}

/** Nested settings with one leaf set, creating the groups it needs. */
export function withSetting<T extends Record<string, unknown>>(
  values: T,
  path: string,
  value: unknown,
): T {
  const [key, ...rest] = path.split(".");

  if (!key) return values;

  const current = values[key];

  return {
    ...values,
    [key]: rest.length
      ? withSetting(
          current !== null && typeof current === "object"
            ? (current as Record<string, unknown>)
            : {},
          rest.join("."),
          value,
        )
      : value,
  };
}

/** Merges a partial update into settings: groups merge, leaves replace. */
export function mergeSettings<T extends Record<string, unknown>>(
  values: T,
  update: Record<string, unknown>,
): T {
  return settingPaths(update).reduce(
    (merged, path) => withSetting(merged, path, settingAt(update, path)),
    values,
  );
}

/**
 * The update schema: every key optional, defaults removed and objects strict,
 * so unknown paths fail and each leaf keeps its title.
 */
function deepPartial(schema: z.ZodType): z.ZodType {
  const inner = unwrapped(schema);

  if (!(inner instanceof z.ZodObject)) return inner;

  const shape = inner.shape as Record<string, z.ZodType>;

  const partial = z.strictObject(
    Object.fromEntries(
      Object.entries(shape).map(([key, value]) => [
        key,
        deepPartial(value).optional(),
      ]),
    ),
  );

  const meta = settingMeta(schema);

  return Object.keys(meta).length ? partial.meta(meta) : partial;
}

export const settingsPatchSchema = deepPartial(settingsSchema);
