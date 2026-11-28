import {
  aboveEffortCap,
  effortCap,
  modelAllowed,
  modelName,
  MODELS_LIMITED,
  orgEffort,
  resolvedModel,
  runtimeDefault,
  withEffortCap,
  WORKER_DEFAULTS_HELP,
} from "../providers/policy.js";
import {
  providerApprovalRows,
  providerRestrictionSections,
  providerSettingsPolicies,
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
import { settingAt } from "./setting-path.js";
import { settingText } from "./setting-text.js";
import {
  branchPrefixPattern,
  profileInstructionsMaxLength,
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
 * What a scope's Inherit lands on: a profile's provider setting, then the
 * runtime default. Reasoning falls back to `modelEffort`, the level the model
 * the scope runs has by default, and only a level the model supports.
 */
function inherited(
  values: unknown,
  scope: { provider: string; providerScope: boolean },
  catalog: Catalog | undefined,
  modelEffort: string | undefined,
  levels: readonly string[] | undefined,
) {
  // Provider scopes inherit the runtime default.
  const parent = resolveModelDefaults(
    values,
    scope.providerScope ? {} : { provider: scope.provider },
  );

  const models = catalog?.models ?? [];
  const runtime = runtimeDefault(models);

  const fits = (level: string | undefined) =>
    level && (!levels || levels.includes(level)) ? level : undefined;

  return {
    model: parent.model ? modelName(models, parent.model) : runtime.model,
    effort: fits(parent.reasoning_effort) ?? fits(modelEffort),
  };
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

  // Role choices apply across providers; provider scopes use their own catalog.
  const choices = catalogs
    .filter((catalog) => !providerScope || catalog.provider === scope)
    .flatMap((catalog) => catalog.models ?? []);

  const saved = scalarText(settingAt(values, modelPath));
  const savedEffort = scalarText(settingAt(values, effortPath), "default");

  // The model this scope's tasks run: its own, then the scopes it inherits.
  const chain = { provider, profile: providerScope ? undefined : scope };

  const catalog = catalogs.find((item) => item.provider === provider);

  // Default runs the org's model, when it sets one.
  const effectiveModel = resolveModelDefaults(values, chain).model ?? "default";

  const metadata = catalog?.models?.find(
    (model) => model.value === effectiveModel,
  );

  const levels =
    metadata?.supportsEffort === false ? [] : metadata?.supportedEffortLevels;

  const runs = resolvedModel(catalog?.models ?? [], effectiveModel);
  const cap = effortCap(catalog?.policy, runs);

  // The model's own default includes the org's, which covers an unlisted model.
  const inherits = inherited(
    values,
    { provider, providerScope },
    catalog,
    metadata?.resolvedEffort ?? orgEffort(catalog?.policy, runs),
    levels,
  );

  // Saved choices stay selectable even when the catalog no longer lists them.
  const modelChoices = choices.length
    ? [
        {
          value: "",
          label: inherits.model ? `Inherit (${inherits.model})` : "Inherit",
        },
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

  return {
    modelPath,
    effortPath,
    provider,
    providerScope,
    effectiveModel,
    levels,
    modelChoices,
    modelExcluded: !modelAllowed(catalog?.policy, choices, saved),
    ...effortScope(levels, providerScope, savedEffort, cap, inherits.effort),
  };
}

/**
 * A scope's effort choices: a provider's offers the levels its model
 * supports, when known, and others offer all of them. Levels above the
 * org's cap are locked, and Inherit names the level it lands on.
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

  const scopeRow = (scope: string, label: string): ModelScope => {
    const info = modelScope(scope, input);

    // A provider's menu lists its own catalog. Profile menus list every
    // provider's models, so any allowlist shortens them.
    const modelsLimited = input.catalogs.some(
      ({ provider, policy }) =>
        policy?.available_models && (!info.providerScope || provider === scope),
    );

    return {
      id: scope,
      label,
      model: {
        path: info.modelPath,
        label: `${label} model`,
        options: info.modelChoices,
        ...(modelsLimited ? { footer: MODELS_LIMITED } : {}),
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

  const taskProvider = scalarText(settingAt(values, "task.provider"));
  const profileModel = modelPath(settingAt(values, "task.worker_profile"));
  const providerModel = modelPath(taskProvider);

  // New tasks inherit the saved provider's defaults.
  const taskCatalog = input.catalogs.find(
    ({ provider }) => provider === taskProvider,
  );

  const inherit = providerSettingsPolicies[taskProvider]?.inheritHelp(
    taskCatalog?.policy,
    runtimeDefault(taskCatalog?.models ?? []),
  ) ?? [WORKER_DEFAULTS_HELP];

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
    {
      id: "appearance",
      title: "Appearance",
      rows: [
        { kind: "switch", ...described("panel.row_icons") },
        { kind: "switch", ...described("panel.plan_usage_meter") },
      ],
    },
  ];

  return input.catalogs.reduce(
    (applied, { provider, policy }) =>
      providerSettingsPolicies[provider]?.apply(applied, policy, values) ??
      applied,
    sections,
  );
}
