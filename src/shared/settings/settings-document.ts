import {
  inheritHelp,
  withClaudePolicy,
} from "../providers/claude/settings-policy.js";
import {
  aboveEffortCap,
  effortCap,
  modelAllowed,
  MODELS_LIMITED,
  orgEffort,
  resolvedModel,
  withEffortCap,
} from "../providers/policy.js";
import {
  providerApprovalRows,
  providerRestrictionSections,
} from "../providers/settings.js";
import { type ModelChoice, type ProviderPolicy } from "../providers/types.js";
import { roles } from "../tasks/model.js";
import { reasoningLevels } from "../tasks/reasoning.js";
import { scalarText, titleCase } from "../text.js";
import { settingSectionSchema } from "./document-contract.generated.js";
import type {
  HelpPart,
  ModelScope,
  SettingOption,
  SettingSection,
} from "./document-contract.js";
import { modelScopePath, resolveModelDefaults } from "./model-defaults.js";
import { settingText } from "./setting-text.js";
import {
  branchPrefixPattern,
  profileInstructionsMaxLength,
  settingAt,
  settingSchemaAt,
} from "./settings-schema.js";

export const sectionSchema = settingSectionSchema;

export type {
  HelpPart,
  ModelScope,
  ProseSetting,
  SettingRow,
  SettingSection,
} from "./document-contract.js";

// Agents read this in an effort field's description, and the panel shows it
// beside a scope flagged `unsupported`.
export const unsupportedEffortWarning =
  "This model doesn't support this level. New tasks use the default.";

/** Help parts, with a link to a setting the panel doesn't show as plain text. */
export const withHelp = (parts: HelpPart[], shown: unknown) =>
  parts.map((part) =>
    typeof part === "string" || settingAt(shown, part.setting) !== undefined
      ? part
      : part.text,
  );

/** A row's path with the label and help its schema defines. */
function described(path: string) {
  const schema = settingSchemaAt(path);
  if (!schema) throw new Error(`Unknown setting ${path}`);

  return { path, ...settingText(schema) };
}

const options = (labels: Record<string, string>): SettingOption[] =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));

type Catalog = {
  provider: string;
  models?: ModelChoice[];
  policy?: ProviderPolicy;
};

export interface ScopeInput {
  values: unknown;
  providers: string[];
  catalogs: Catalog[];
  modelProviders?: string[];
}

/**
 * The org's reasoning a scope's Inherit lands on: its level for the model the
 * scope runs, when no scope it inherits sets one and the model supports it.
 */
function orgInherited(
  values: unknown,
  scope: { id: string; provider: string; providerScope: boolean },
  policy: ProviderPolicy | undefined,
  model: string,
  levels: readonly string[] | undefined,
) {
  // Global inherits no scope, and Claude only Global.
  const parent = scope.providerScope ? {} : { provider: scope.provider };

  const inherits =
    scope.id !== "global" &&
    resolveModelDefaults(values, parent, policy).reasoning_effort;

  const org = orgEffort(policy, model);

  return !inherits && org && (!levels || levels.includes(org))
    ? org
    : undefined;
}

/**
 * One model/effort scope: its choices, and the effort levels its effective
 * model supports (undefined when unknown).
 */
export function modelScope(
  scope: string,
  { values, providers, catalogs }: ScopeInput,
) {
  const scopePath = modelScopePath(scope);
  const modelPath = `${scopePath}.model`;
  const effortPath = `${scopePath}.reasoning_effort`;
  const providerScope = providers.includes(scope);

  const provider = providerScope
    ? scope
    : scalarText(settingAt(values, "task.provider"));

  // Global and role choices apply across providers; provider scopes use their own catalog.
  const choices = catalogs
    .filter((catalog) => !providerScope || catalog.provider === scope)
    .flatMap((catalog) => catalog.models ?? []);

  const saved = scalarText(settingAt(values, modelPath));
  const savedEffort = scalarText(settingAt(values, effortPath), "default");

  // The model this scope's tasks run: its own, then the scopes it inherits.
  const chain =
    scope === "global"
      ? {}
      : { provider, profile: providerScope ? undefined : scope };

  const catalog = catalogs.find((item) => item.provider === provider);

  // Default runs the org's model, when it sets one.
  const effectiveModel =
    resolveModelDefaults(values, chain, catalog?.policy).model ?? "default";

  const metadata = catalog?.models?.find(
    (model) => model.value === effectiveModel,
  );

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

  const runs = resolvedModel(catalog?.models ?? [], effectiveModel);
  const cap = effortCap(catalog?.policy, runs);

  const inherited = orgInherited(
    values,
    { id: scope, provider, providerScope },
    catalog?.policy,
    runs,
    levels,
  );

  return {
    modelPath,
    effortPath,
    provider,
    providerScope,
    effectiveModel,
    levels,
    modelChoices,
    modelExcluded: !modelAllowed(catalog?.policy, choices, saved),
    ...effortScope(levels, providerScope, savedEffort, cap, inherited),
  };
}

/**
 * A scope's effort choices: a provider's offers the levels its model
 * supports, when known, and others offer all of them. Levels above the
 * org's cap are locked, and Inherit names the org's level it lands on.
 */
function effortScope(
  levels: readonly string[] | undefined,
  providerScope: boolean,
  savedEffort: string,
  cap: string | undefined,
  inherited: string | undefined,
) {
  const choices =
    providerScope && levels
      ? [
          ...new Set([
            ...levels,
            ...(savedEffort === "default" ? [] : [savedEffort]),
          ]),
        ]
      : [...reasoningLevels];

  const unsupported =
    levels !== undefined &&
    savedEffort !== "default" &&
    !levels.includes(savedEffort);

  return {
    effortChoices: withEffortCap(
      [
        {
          value: "default",
          label: inherited ? `Inherit (${titleCase(inherited)})` : "Inherit",
        },
        ...choices.map((level) => ({ value: level, label: level })),
      ],
      cap,
    ),
    // Claude Code lowers a saved effort above the cap. A start skips one the
    // model can't run, so only that warning applies.
    effortLowered:
      !unsupported && aboveEffortCap(savedEffort, cap) ? cap : undefined,
    unsupported,
  };
}

/** The dialog's sections, in display order. */
export function settingsSections(input: ScopeInput): SettingSection[] {
  const { values, providers } = input;

  const claudePolicy = input.catalogs.find(
    ({ provider }) => provider === "claude",
  )?.policy;

  const scopeRow = (scope: string, label: string): ModelScope => {
    const info = modelScope(scope, input);

    return {
      id: scope,
      label,
      model: {
        path: info.modelPath,
        label: `${label} model`,
        options: info.modelChoices,
        // Claude is the only provider, so its allowlist shortens every menu.
        ...(claudePolicy?.available_models ? { footer: MODELS_LIMITED } : {}),
        ...(info.modelExcluded
          ? {
              warning:
                "Your organization doesn't allow this model. New tasks use the default.",
            }
          : {}),
      },
      effort: {
        path: info.effortPath,
        label: `${label} reasoning`,
        options: info.effortChoices,
        unsupported: info.unsupported,
        ...(info.effortLowered
          ? {
              warning: `Your organization doesn't allow this level. New tasks use ${titleCase(info.effortLowered)}.`,
            }
          : {}),
      },
    };
  };

  // Each model section explains inheritance from its own rows' side and links
  // to the other section's exact setting; the defaults stand in for "the
  // task's" profile and provider.
  const modelPath = (scope: unknown) =>
    `${modelScopePath(scalarText(scope))}.model`;

  const profileModel = modelPath(settingAt(values, "task.worker_profile"));
  const providerModel = modelPath(settingAt(values, "task.provider"));

  // Claude is the only provider, so its org defaults are what Inherit uses.
  const inherit = inheritHelp(claudePolicy, {
    text: "Global",
    setting: "models.global.model",
  });

  const defaultsHelp = withHelp(
    [
      "The task's ",
      { text: "worker profile", setting: profileModel },
      " defaults override these. Inherit uses ",
      ...inherit,
      " Task choices override all defaults.",
    ],
    values,
  );

  const profilesHelp = withHelp(
    [
      "Inherit uses the task's ",
      { text: "provider", setting: providerModel },
      " default, then ",
      ...inherit,
      " Task choices override profile defaults.",
    ],
    values,
  );

  const userOnly = "Only you can change these settings.";

  const sections: SettingSection[] = [
    {
      id: "task",
      title: "Task defaults",
      rows: [
        {
          kind: "select",
          ...described("task.provider"),
          options: providers.map((value) => ({
            value,
            label: titleCase(value),
          })),
        },
        {
          kind: "select",
          ...described("task.worker_profile"),
          options: roles.map((value) => ({ value, label: titleCase(value) })),
        },
        {
          kind: "select",
          ...described("task.workspace_strategy"),
          options: options({
            current_repo: "Project folder",
            worktree: "Isolated worktree",
          }),
        },
        {
          kind: "text",
          ...described("task.worktree_branch_prefix"),
          maxLength: 100,
          pattern: branchPrefixPattern,
        },
        {
          kind: "budget",
          ...described("task.budget.max_cost_usd"),
          unit: "USD",
          min: 0.01,
        },
        {
          kind: "budget",
          ...described("task.budget.max_runtime_minutes"),
          unit: "mins",
          min: 0.01,
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
          kind: "select",
          ...described("approvals.decider"),
          options: options({ user: "User", parent_agent: "Parent agent" }),
        },
        { kind: "switch", ...described("projects.auto_register_chat") },
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
      title: "Worker profiles",
      help: profilesHelp,
      rows: [
        {
          kind: "models",
          scopes: roles.map((role) => ({
            ...scopeRow(role, titleCase(role)),
            instructions: {
              ...described(`profiles.${role}.instructions`),
              maxLength: profileInstructionsMaxLength,
            },
          })),
        },
      ],
    },
  ];

  return withClaudePolicy(sections, claudePolicy, values);
}
