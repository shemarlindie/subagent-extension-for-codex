import type { ProviderPolicy } from "../providers/types.js";
import { roles } from "../tasks/model.js";
import { scalarText } from "../text.js";
import { settingAt } from "./settings-schema.js";

/**
 * A model scope's settings path: `global`, a provider (`models.providers.<id>`)
 * or a worker profile (`models.profiles.<id>`).
 */
export function modelScopePath(scope: string) {
  if (scope === "global") return "models.global";

  return (roles as readonly string[]).includes(scope)
    ? `models.profiles.${scope}`
    : `models.providers.${scope}`;
}

type ModelDefaultsScope = { provider?: string; profile?: string };

/** Which defaults the provider's org policy sets. */
type OrgDefaults = Pick<ProviderPolicy, "default_model" | "default_effort">;

/**
 * The saved model and effort defaults for a task. Each resolves separately
 * through the profile, provider and global scopes. A blank model or `default`
 * effort inherits the next one. The org's default takes the global scope's
 * place, since only the provider applies it. Undefined leaves the provider
 * runtime's default, which is the org's when it sets one. The provider
 * results skip the profile scope.
 */
export function resolveModelDefaults(
  values: unknown,
  { provider, profile }: ModelDefaultsScope,
  org?: OrgDefaults,
) {
  const saved = (scope: string | undefined, key: string) =>
    scope === undefined
      ? ""
      : scalarText(settingAt(values, `${modelScopePath(scope)}.${key}`));

  const model = (...scopes: (string | undefined)[]) =>
    scopes.map((scope) => saved(scope, "model")).find(Boolean);

  const effort = (...scopes: (string | undefined)[]) =>
    scopes
      .map((scope) => saved(scope, "reasoning_effort"))
      .find((value) => value && value !== "default");

  const globalModel = org?.default_model ? undefined : "global";
  const globalEffort = org?.default_effort ? undefined : "global";

  return {
    model: model(profile, provider, globalModel),
    reasoning_effort: effort(profile, provider, globalEffort),
    providerModel: model(provider, globalModel),
    providerReasoning: effort(provider, globalEffort),
  };
}
