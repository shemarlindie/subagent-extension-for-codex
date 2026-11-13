import { roles } from "../tasks/model.js";
import { scalarText } from "../text.js";
import { settingAt } from "./settings-schema.js";

/**
 * A model scope's settings path: a provider (`models.providers.<id>`)
 * or a worker profile (`models.profiles.<id>`).
 */
export function modelScopePath(scope: string) {
  return (roles as readonly string[]).includes(scope)
    ? `models.profiles.${scope}`
    : `models.providers.${scope}`;
}

type ModelDefaultsScope = { provider?: string; profile?: string };

/** Saved model and effort resolve separately through profile and provider defaults. */
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
    model: model(profile, provider),
    reasoning_effort: effort(profile, provider),
    providerModel: model(provider),
    providerReasoning: effort(provider),
  };
}
