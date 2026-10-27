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

/**
 * The saved model and effort defaults for a task. Each resolves separately
 * through the profile, provider and global scopes. A blank model or `default`
 * effort inherits the next one. Undefined leaves the provider runtime's
 * default. The provider results skip the profile scope.
 */
export function resolveModelDefaults(
  values: unknown,
  { provider, profile }: ModelDefaultsScope,
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

  return {
    model: model(profile, provider, "global"),
    reasoning_effort: effort(profile, provider, "global"),
    providerModel: model(provider, "global"),
    providerReasoning: effort(provider, "global"),
  };
}
