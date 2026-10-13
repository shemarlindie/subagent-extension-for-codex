import {
  providerApprovalRows,
  providerRestrictionSections,
  providerSettingHelp,
} from "../providers/settings.js";
import { type ModelChoice } from "../providers/types.js";
import { roles } from "../tasks/model.js";
import { reasoningLevels } from "../tasks/reasoning.js";
import { scalarText } from "../text.js";
import { settingSectionSchema } from "./document-contract.generated.js";
import type {
  HelpPart,
  ModelScope,
  SettingOption,
  SettingSection,
} from "./document-contract.js";

export const sectionSchema = settingSectionSchema;

export type {
  HelpPart,
  ModelScope,
  SettingRow,
  SettingSection,
} from "./document-contract.js";

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

/** A setting key or scope as a label: `worker_profile` reads "Worker profile". */
export const titleCase = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " ");

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

  const saved = scalarText(values[modelKey]),
    savedEffort = scalarText(values[effortKey], "default");

  const effectiveModel =
    saved ||
    (scope !== "global" && !providerScope
      ? scalarText(values[`${provider}_default_model`])
      : "") ||
    (scope !== "global" ? scalarText(values.default_model) : "") ||
    "default";

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
  const profileModel = `${scalarText(values.default_worker_profile)}_default_model`,
    providerModel = `${scalarText(values.default_provider)}_default_model`;

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
          amount: remembered.max_cost_usd,
        },
        {
          kind: "budget",
          key: "max_runtime_minutes",
          toggle: "use_runtime_budget",
          label: "Runtime limit",
          unit: "mins",
          min: 0.01,
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
