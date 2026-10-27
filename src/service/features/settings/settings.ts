import { eq } from "drizzle-orm";
import { z } from "zod";

import {
  builtinProviderMetadata,
  type ProviderMetadata,
} from "../../../shared/providers/metadata.js";
import {
  preferredSettingsProvider,
  providerModelSettingScopes,
  validateProviderSettingsUpdate,
} from "../../../shared/providers/settings.js";
import { type ModelChoice } from "../../../shared/providers/types.js";
import {
  modelScope,
  settingsSections,
  unsupportedEffortWarning,
} from "../../../shared/settings/settings-document.js";
import {
  type InputAuthority,
  modelNameSchema,
  reasoningSchema,
  roles,
} from "../../../shared/tasks/model.js";
import { scalarText } from "../../../shared/text.js";
import { type Database } from "../../platform/database/database.js";
import { checkStored, decodeStored } from "../../platform/database/decode.js";
import { userSettings } from "./schema.js";
import {
  initialValuesSchema,
  panelValuesSchema,
  persistedValuesSchema,
  providerModelKeys,
  settingsReadOutputSchema,
  settingsUpdateSchema,
  type SettingsValues,
  valuesSchema,
} from "./settings-values.js";

/**
 * Resolves a budget limit. An explicit toggle turns it on at the amount or
 * off. Without a toggle, a sent field replaces the saved value, and null on
 * either side turns the limit off.
 */
function budgetLimit(
  enabled: boolean | undefined,
  amount: number,
  field: number | null | undefined,
  saved: number | null | undefined,
) {
  if (enabled === undefined) {
    if (field === undefined) return saved;

    return field === null || saved === null ? null : field;
  }

  return enabled ? amount : null;
}

export class Settings {
  readonly providers: () => string[];
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
      max_runtime_minutes: null,
      max_cost_usd: null,
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

    if (!this.providers().includes(body.default_provider as string)) {
      body.default_provider = this.providers()[0];
    }

    return checkStored(persistedValuesSchema, body, record);
  }

  values(owner: string): SettingsValues {
    const { cost_budget_amount, runtime_budget_amount, ...values } =
      this.saved(owner);

    const available = this.providers();

    // A saved provider can disappear when the service configuration changes.
    if (!available.includes(values.default_provider)) {
      values.default_provider = valuesSchema.shape.default_provider.parse(
        available[0],
      );
    }

    return values;
  }

  /** Saved defaults for transfer, including amounts remembered while limits are off. */
  exportValues(owner: string) {
    const saved = this.saved(owner);

    return {
      ...this.values(owner),
      max_cost_usd: saved.max_cost_usd ?? saved.cost_budget_amount ?? 5,
      use_cost_budget: saved.max_cost_usd !== null,
      max_runtime_minutes:
        saved.max_runtime_minutes ?? saved.runtime_budget_amount ?? 20,
      use_runtime_budget: saved.max_runtime_minutes !== null,
    };
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

      if (info.modelChoices) {
        modelField.enum = info.modelChoices.map((option) => option.value);
      }

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

    if (authority !== "user" && set.auto_register_chat_project !== undefined) {
      throw new Error(
        "Automatic project registration requires a user decision in settings",
      );
    }

    if (authority !== "user" && set.default_approval_mode !== undefined) {
      throw new Error("Approval settings require a user decision in settings");
    }

    validateProviderSettingsUpdate(set, authority);

    if (
      set.default_provider &&
      !this.providers().includes(set.default_provider)
    ) {
      throw new Error("Provider is not enabled");
    }

    // Synchronous read/merge/write preserves omitted fields across concurrent requests.
    const previous = this.saved(owner);
    const { use_cost_budget, use_runtime_budget, ...fields } = set;

    const amount =
      fields.max_cost_usd ??
      previous.max_cost_usd ??
      previous.cost_budget_amount ??
      5;

    const max_cost_usd = budgetLimit(
      use_cost_budget,
      amount,
      fields.max_cost_usd,
      previous.max_cost_usd,
    );

    const runtimeAmountValue =
      fields.max_runtime_minutes ??
      previous.max_runtime_minutes ??
      previous.runtime_budget_amount ??
      20;

    const max_runtime_minutes = budgetLimit(
      use_runtime_budget,
      runtimeAmountValue,
      fields.max_runtime_minutes,
      previous.max_runtime_minutes,
    );

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

    if (args.model !== undefined) {
      args.model = modelNameSchema.parse(args.model);
    }

    if (args.reasoning_effort !== undefined) {
      args.reasoning_effort = reasoningSchema.parse(args.reasoning_effort);
    }

    const defaults = this.values(owner);
    const provider = scalarText(args.provider ?? defaults.default_provider);

    const role = scalarText(
      args.worker_profile ?? defaults.default_worker_profile,
    );

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
