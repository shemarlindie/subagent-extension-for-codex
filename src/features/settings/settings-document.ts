import { z } from "zod";

import {
  type ModelChoice,
  reasoningLevels,
  roles,
} from "../../shared/contracts.js";
import {
  providerApprovalRows,
  providerRestrictionSections,
  providerSettingHelp,
} from "../providers/settings.js";

/**
 * The settings dialog's description of each section and row. The panel
 * renders it as given; nothing about layout or labels is inferred there.
 */

/** Help text in order: plain text, or a link naming the setting it opens. */
const helpPartSchema = z.union([
  z.string(),
  z.object({ text: z.string(), setting: z.string() }),
]);

export type HelpPart = z.infer<typeof helpPartSchema>;

const optionSchema = z.object({
  value: z.string(),
  label: z.string(),
  description: z.string().optional(),
});

export type SettingOption = z.infer<typeof optionSchema>;

const base = {
  key: z.string(),
  label: z.string(),
  help: z.array(helpPartSchema).optional(),
};

const modelScopeSchema = z.object({
  label: z.string(),
  model: z.object({
    key: z.string(),
    label: z.string(),
    // Without a discovered catalog the model ID is typed instead.
    options: z.array(optionSchema).optional(),
  }),
  effort: z.object({
    key: z.string(),
    label: z.string(),
    options: z.array(optionSchema),
    // The saved effort is not supported by the scope's effective model.
    unsupported: z.boolean(),
  }),
});

export type ModelScope = z.infer<typeof modelScopeSchema>;

const rowSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("select"),
    ...base,
    options: z.array(optionSchema),
  }),
  z.object({ kind: z.literal("switch"), ...base }),
  z.object({
    kind: z.literal("text"),
    ...base,
    maxLength: z.number(),
    // A regular expression the whole value must match.
    pattern: z.string(),
  }),
  z.object({
    kind: z.literal("budget"),
    ...base,
    // The update tool's on/off key for this limit.
    toggle: z.string(),
    unit: z.string(),
    min: z.number(),
    max: z.number(),
    // The amount shown while the limit is off, restored when it turns on.
    amount: z.number(),
  }),
  z.object({ kind: z.literal("models"), scopes: z.array(modelScopeSchema) }),
]);

export type SettingRow = z.infer<typeof rowSchema>;

export const sectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  help: z.array(helpPartSchema).optional(),
  rows: z.array(rowSchema),
});

export type SettingSection = z.infer<typeof sectionSchema>;

/**
 * Plain help shared by a setting's row and its schema description, so agents
 * and the panel read the same text. Options are named by their display labels.
 */
export const settingHelp = {
  auto_register_chat_project:
    "When a chat starts a task, register the chat's local Git root from host directory metadata, never from task paths. Turning this off keeps projects already registered.",
  ...providerSettingHelp,
  worktree_branch_prefix:
    "Each worktree task works on its own branch, named this prefix followed by the task ID.",
};

/** Characters a branch prefix may use; Git checks the whole branch name. */
export const branchPrefixPattern = "[\\w./-]*";

// Agents read this in an effort field's description; the panel shows it
// beside a scope flagged `unsupported`.
export const unsupportedEffortWarning =
  "The saved effort is not supported by this model.";

/** Help parts, with a link to a setting the panel doesn't show as plain text. */
export const withHelp = (parts: HelpPart[], shown: Record<string, unknown>) =>
  parts.map((part) =>
    typeof part === "string" || part.setting in shown ? part : part.text,
  );

const titleCase = (value: string) =>
  value[0].toUpperCase() + value.slice(1).replaceAll("_", " ");

const options = (labels: Record<string, string>): SettingOption[] =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));

type Catalog = { provider: string; models?: ModelChoice[] };

export interface ScopeInput {
  values: Record<string, unknown>;
  providers: string[];
  catalogs: Catalog[];
  modelProviders?: string[];
}

/**
 * One model/effort scope: its choices, and the effort levels its effective
 * model supports (undefined when unknown).
 */
export function modelScope(
  scope: string,
  { values, providers, catalogs }: ScopeInput,
) {
  const prefix = scope === "global" ? "default" : `${scope}_default`,
    modelKey = `${prefix}_model`,
    effortKey = `${prefix}_reasoning_effort`,
    providerScope = providers.includes(scope),
    provider = providerScope ? scope : String(values.default_provider);

  // Global and role choices apply across providers; provider scopes use their own catalog.
  const choices = catalogs
    .filter((catalog) => !providerScope || catalog.provider === scope)
    .flatMap((catalog) => catalog.models ?? []);

  const saved = String(values[modelKey] ?? ""),
    savedEffort = String(values[effortKey] ?? "default");

  const effectiveModel = String(
    saved ||
      (scope !== "global" && !providerScope
        ? values[`${provider}_default_model`]
        : "") ||
      (scope !== "global" ? values.default_model : "") ||
      "default",
  );

  const metadata = catalogs
    .find((catalog) => catalog.provider === provider)
    ?.models?.find((model) => model.value === effectiveModel);

  const levels =
    metadata?.supportsEffort === false ? [] : metadata?.supportedEffortLevels;

  // Saved choices stay selectable even when the catalog no longer lists them.
  const modelChoices = choices.length
    ? [
        { value: "", label: "Inherit" },
        ...new Map(
          choices.map((model) => [
            model.value,
            {
              value: model.value,
              label: model.displayName,
              description: model.description || undefined,
            },
          ]),
        ).values(),
        ...(saved && !choices.some((model) => model.value === saved)
          ? [{ value: saved, label: saved }]
          : []),
      ]
    : undefined;

  const effortLevels =
    providerScope && levels !== undefined
      ? [
          ...new Set([
            ...levels,
            ...(savedEffort === "default" ? [] : [savedEffort]),
          ]),
        ]
      : [...reasoningLevels];

  return {
    modelKey,
    effortKey,
    provider,
    providerScope,
    effectiveModel,
    levels,
    modelChoices,
    effortChoices: [
      { value: "default", label: "Inherit" },
      ...effortLevels.map((level) => ({ value: level, label: level })),
    ],
    unsupported:
      levels !== undefined &&
      savedEffort !== "default" &&
      !levels.some((level) => level === savedEffort),
  };
}

export interface SectionInput extends ScopeInput {
  /** Every setting the panel shows, for link checks. */
  shown: Record<string, unknown>;
  /** Amounts to show for limits that are off. */
  remembered: { max_cost_usd: number; max_runtime_minutes: number };
}

/** The dialog's sections, in display order. */
export function settingsSections(input: SectionInput): SettingSection[] {
  const { values, providers, shown, remembered } = input;

  const scopeRow = (scope: string, label: string): ModelScope => {
    const info = modelScope(scope, input);

    return {
      label,
      model: {
        key: info.modelKey,
        label: `${label} model`,
        options: info.modelChoices,
      },
      effort: {
        key: info.effortKey,
        label: `${label} reasoning effort`,
        options: info.effortChoices,
        unsupported: info.unsupported,
      },
    };
  };

  // Each model section explains inheritance from its own rows' side and links
  // to the other section's exact setting; the defaults stand in for "the
  // task's" profile and provider.
  const profileModel = `${values.default_worker_profile}_default_model`,
    providerModel = `${values.default_provider}_default_model`;

  const defaultsHelp = withHelp(
    [
      "These apply unless a task's ",
      { text: "worker profile", setting: profileModel },
      " sets its own model. A provider set to Inherit uses ",
      { text: "Global", setting: "default_model" },
      "; if Global also inherits, the provider uses its own default. Reasoning effort works the same way. A model chosen for a task overrides all of these.",
    ],
    shown,
  );

  const profilesHelp = withHelp(
    [
      "A profile set to Inherit uses the task's ",
      { text: "provider", setting: providerModel },
      " model, such as Claude, then ",
      { text: "Global", setting: "default_model" },
      ". If those also inherit, the provider uses its own default. Reasoning effort works the same way. A model chosen for a task overrides these.",
    ],
    shown,
  );

  const userOnly = "Only you can change these; agents can't.";

  return [
    {
      id: "task",
      title: "Task defaults",
      help: ["Used when a task doesn't choose its own."],
      rows: [
        {
          kind: "select",
          key: "default_provider",
          label: "Provider",
          options: providers.map((value) => ({
            value,
            label: titleCase(value),
          })),
        },
        {
          kind: "select",
          key: "default_worker_profile",
          label: "Worker profile",
          options: roles.map((value) => ({ value, label: titleCase(value) })),
        },
        {
          kind: "select",
          key: "default_workspace_strategy",
          label: "Workspace",
          options: options({
            current_repo: "Current repository",
            worktree: "Isolated worktree",
          }),
        },
        {
          kind: "text",
          key: "worktree_branch_prefix",
          label: "Worktree branch prefix",
          help: [settingHelp.worktree_branch_prefix],
          maxLength: 100,
          pattern: branchPrefixPattern,
        },
        {
          kind: "budget",
          key: "max_cost_usd",
          toggle: "use_cost_budget",
          label: "Cost limit",
          unit: "USD",
          min: 0.01,
          max: 100,
          amount: remembered.max_cost_usd,
        },
        {
          kind: "budget",
          key: "max_runtime_minutes",
          toggle: "use_runtime_budget",
          label: "Runtime limit",
          unit: "mins",
          min: 0.01,
          max: 120,
          amount: remembered.max_runtime_minutes,
        },
      ],
    },
    {
      id: "approvals",
      title: "Approvals and projects",
      help: [userOnly],
      rows: [
        ...providerApprovalRows,
        {
          kind: "switch",
          key: "auto_register_chat_project",
          label: "Automatically add chat projects",
          help: [settingHelp.auto_register_chat_project],
        },
      ],
    },
    ...providerRestrictionSections,
    // One section per tier keeps the many model/effort pairs in two tables.
    {
      id: "models",
      title: "Model defaults",
      help: defaultsHelp,
      rows: [
        {
          kind: "models",
          scopes: [
            scopeRow("global", "Global"),
            ...(input.modelProviders ?? providers).map((provider) =>
              scopeRow(provider, titleCase(provider)),
            ),
          ],
        },
      ],
    },
    {
      id: "profile-models",
      title: "Worker profile models",
      help: profilesHelp,
      rows: [
        {
          kind: "models",
          scopes: roles.map((role) => scopeRow(role, titleCase(role))),
        },
      ],
    },
  ];
}
