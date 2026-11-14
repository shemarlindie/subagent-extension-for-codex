import { eq } from "drizzle-orm";
import { z } from "zod";

import {
  builtinProviderMetadata,
  type ProviderMetadata,
} from "../../../shared/providers/metadata.js";
import {
  preferredSettingsProvider,
  providerModelSettingScopes,
} from "../../../shared/providers/settings.js";
import { resolveModelDefaults } from "../../../shared/settings/model-defaults.js";
import { settingText } from "../../../shared/settings/setting-text.js";
import {
  modelScope,
  type ScopeInput,
  settingsSections,
  unsupportedEffortWarning,
} from "../../../shared/settings/settings-document.js";
import {
  mergeSettings,
  settingAt,
  settingPaths,
  settingSchemaAt,
  settingsDefaults,
  settingsPatchSchema,
  settingsSchema,
  type SettingsValues,
  userOnlySetting,
} from "../../../shared/settings/settings-schema.js";
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
  settingsReadOutputSchema,
  settingsUpdateSchema,
} from "./settings-tool-schemas.js";

type JsonSchema = Record<string, unknown> & {
  properties?: Record<string, JsonSchema>;
};

/** A JSON Schema's node for a dotted settings path. */
function jsonSchemaAt(schema: JsonSchema, path: string) {
  const node = path
    .split(".")
    .reduce<JsonSchema | undefined>(
      (node, key) => node?.properties?.[key],
      schema,
    );

  if (!node) throw new Error(`The settings schema has no ${path}.`);

  return node;
}

/** A task budget from a saved limit: its amount when on, otherwise no limit. */
const limit = ({ enabled, amount }: { enabled: boolean; amount: number }) =>
  enabled ? amount : null;

export class Settings {
  readonly providers: () => [string, ...string[]];
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
      const [first, ...rest] = providers().filter((provider) =>
        this.metadata(provider),
      );

      return first ? [first, ...rest] : [providerModelSettingScopes[0]];
    };
  }

  /** The values a new user starts with, which resets restore. */
  defaults(): SettingsValues {
    return settingsDefaults(preferredSettingsProvider(this.providers()));
  }

  /** The owner's saved settings, with a provider that's still enabled. */
  values(owner: string): SettingsValues {
    const row = this.database.orm
      .select({ body: userSettings.body })
      .from(userSettings)
      .where(eq(userSettings.owner, owner))
      .get();

    if (!row) return this.defaults();

    const record = `settings for ${owner}`;

    const stored = decodeStored(z.looseObject({}), row.body, record);

    // Retired global defaults never migrate into provider or profile choices.
    if (
      stored.models &&
      typeof stored.models === "object" &&
      !Array.isArray(stored.models)
    ) {
      delete (stored.models as Record<string, unknown>).global;
    }

    const values = checkStored(settingsSchema, stored, record);

    // A saved provider can disappear when the service configuration changes.
    if (!this.providers().includes(values.task.provider)) {
      values.task.provider = this.providers()[0];
    }

    return values;
  }

  // Enabled providers with model defaults. The others stay saved but hidden.
  private modelProviders(): string[] {
    return providerModelSettingScopes.filter((provider) =>
      this.providers().includes(provider),
    );
  }

  private shown(values: SettingsValues) {
    const shown = this.modelProviders();

    return {
      ...values,
      models: {
        ...values.models,
        providers: Object.fromEntries(
          Object.entries(values.models.providers).filter(([provider]) =>
            shown.includes(provider),
          ),
        ),
      },
    };
  }

  read(owner: string, catalogs: ScopeInput["catalogs"] = []) {
    const providers = this.providers();
    const modelProviders = this.modelProviders();

    catalogs = catalogs.filter((catalog) =>
      providers.includes(catalog.provider),
    );

    // Agents update through this schema, so it lists what an update accepts.
    const schema = z.toJSONSchema(settingsPatchSchema) as JsonSchema;
    jsonSchemaAt(schema, "task.provider").enum = providers;
    const providerModels = jsonSchemaAt(schema, "models.providers");

    for (const provider of providerModelSettingScopes) {
      if (!modelProviders.includes(provider)) {
        delete providerModels.properties?.[provider];
      }
    }

    const values = this.shown(this.values(owner));
    const scopes = { values, providers, catalogs, modelProviders };

    const sections = settingsSections(scopes);

    // Agents read choices and notes from the schema; the panel reads sections,
    // whose intros explain the same chain from each section's side.
    const modelNote =
      "Blank inherits the next default: the task's worker profile, then its provider, then the provider's own default. A model chosen for a task overrides these.";

    for (const scope of [...modelProviders, ...roles]) {
      const info = modelScope(scope, scopes);
      const modelField = jsonSchemaAt(schema, info.modelPath);
      const effortField = jsonSchemaAt(schema, info.effortPath);

      modelField.description = modelNote;

      if (info.modelChoices) {
        modelField.enum = info.modelChoices.map((option) => option.value);
      }

      effortField.enum = info.effortChoices.map((option) => option.value);

      effortField.description = [
        "Inherit uses the next level, like models.",
        info.levels === undefined
          ? "Reasoning support is unknown. The provider checks it when a task starts."
          : `Supported reasoning for ${info.provider} model ${info.effectiveModel}: ${info.levels.length ? info.levels.join(", ") : "provider runtime default only"}.`,
        !info.providerScope && "Applies to every provider.",
        info.unsupported && unsupportedEffortWarning,
      ]
        .filter(Boolean)
        .join(" ");
    }

    return settingsReadOutputSchema.parse({
      schema,
      values,
      defaults: this.shown(this.defaults()),
      sections,
    });
  }

  update(owner: string, input: unknown, authority: InputAuthority = "user") {
    const { set } = settingsUpdateSchema.parse(input);

    const userOnly =
      authority === "user"
        ? undefined
        : settingPaths(set).find((path) => userOnlySetting(path));

    if (userOnly) {
      const schema = settingSchemaAt(userOnly);
      const label = schema ? settingText(schema).label : userOnly;
      throw new Error(`Changing ${label} requires a user decision in settings`);
    }

    const provider = settingAt(set, "task.provider");

    if (
      provider !== undefined &&
      !this.providers().includes(scalarText(provider))
    ) {
      throw new Error("Provider is not enabled");
    }

    // Synchronous read/merge/write preserves omitted fields across concurrent requests.
    const body = JSON.stringify(
      settingsSchema.parse(
        mergeSettings(
          this.values(owner),
          z.record(z.string(), z.unknown()).parse(set),
        ),
      ),
    );

    this.database.orm
      .insert(userSettings)
      .values({ owner, body })
      .onConflictDoUpdate({ target: userSettings.owner, set: { body } })
      .run();

    return { values: this.shown(this.values(owner)) };
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
    const { task } = defaults;

    // Task choices win. Inheritance sentinels leave the saved defaults in control.
    const saved = resolveModelDefaults(defaults, {
      provider: scalarText(args.provider ?? task.provider),
      profile: scalarText(args.worker_profile ?? task.worker_profile),
    });

    const reasoning =
      args.reasoning_effort === "default" ? undefined : args.reasoning_effort;

    return {
      ...args,
      ...(args.provider_options
        ? { provider_options: args.provider_options }
        : {}),
      model: scalarText(args.model) || saved.model,
      reasoning_effort: reasoning ?? saved.reasoning_effort,
      ...(args.approval_mode !== undefined
        ? { approval_mode: args.approval_mode }
        : {}),
      provider: args.provider ?? task.provider,
      worker_profile: args.worker_profile ?? task.worker_profile,
      workspace_strategy: args.workspace_strategy ?? task.workspace_strategy,
      budget: {
        max_runtime_minutes: limit(task.budget.max_runtime_minutes),
        max_cost_usd: limit(task.budget.max_cost_usd),
        ...z.record(z.string(), z.unknown()).parse(args.budget ?? {}),
      },
    };
  }
}
