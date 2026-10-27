import { scalarText } from "../text.js";

/** The model and effort setting keys of a scope: `global`, a provider or a profile. */
export function modelScopeKeys(scope: string) {
  const prefix = scope === "global" ? "default" : `${scope}_default`;

  return {
    modelKey: `${prefix}_model`,
    effortKey: `${prefix}_reasoning_effort`,
  };
}

type ModelDefaultsScope = { provider?: string; profile?: string };

/**
 * The saved model and effort defaults for a task. Each resolves separately
 * through the profile, provider and global scopes; a blank model or `default`
 * effort inherits the next one. Undefined leaves the provider runtime's
 * default. The provider results skip the profile scope.
 */
export function resolveModelDefaults(
  values: Record<string, unknown>,
  { provider, profile }: ModelDefaultsScope,
) {
  const saved = (scope: string | undefined, key: "modelKey" | "effortKey") =>
    scope === undefined ? "" : scalarText(values[modelScopeKeys(scope)[key]]);

  const model = (...scopes: (string | undefined)[]) =>
    scopes.map((scope) => saved(scope, "modelKey")).find(Boolean);

  const effort = (...scopes: (string | undefined)[]) =>
    scopes
      .map((scope) => saved(scope, "effortKey"))
      .find((value) => value && value !== "default");

  return {
    model: model(profile, provider, "global"),
    reasoning_effort: effort(profile, provider, "global"),
    providerModel: model(provider, "global"),
    providerReasoning: effort(provider, "global"),
  };
}
