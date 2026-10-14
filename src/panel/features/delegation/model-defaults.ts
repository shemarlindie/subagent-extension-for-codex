import { providerMetadata } from "../../../shared/providers/metadata";
import { reasoningLevels } from "../../../shared/tasks/reasoning";
import type { Defaults, Worker } from "../../app/state/types";
import { workerChoice } from "./delegation";

/**
 * What a worker choice inherits when its model and reasoning are left at
 * default: the profile's setting, then the provider's, then the global one.
 * Also returns the selected model's metadata and its supported effort levels.
 */
export function modelDefaults(
  defaults: Defaults,
  workers: Worker[],
  worker: string,
  selectedModel: string,
) {
  const { provider, profile: role } = workerChoice(worker);

  const model =
    defaults[`${role}_default_model`] ||
    defaults[`${provider}_default_model`] ||
    defaults.default_model;

  const reasoning = [
    defaults[`${role}_default_reasoning_effort`],
    defaults[`${provider}_default_reasoning_effort`],
    defaults.default_reasoning_effort,
  ].find((value) => value && value !== "default");

  const workerInfo = workers.find((item) => item.provider === provider);

  const metadata = workerInfo?.models?.find(
    (item) => item.value === (selectedModel.trim() || model || "default"),
  );

  const supported =
    metadata?.supportsEffort === false
      ? []
      : (metadata?.supportedEffortLevels ??
        providerMetadata(provider, workerInfo?.metadata)?.defaultEffortLevels ??
        reasoningLevels);

  return {
    provider,
    model,
    reasoning,
    workerInfo,
    metadata,
    supported,
  };
}

/** Why a reasoning effort can't be used, or true when it can. */
export function validateReasoning(
  value: string,
  {
    provider,
    reasoning,
    metadata,
    supported,
  }: ReturnType<typeof modelDefaults>,
) {
  const resolved = value === "default" ? reasoning : value;

  return (
    !resolved ||
    supported.some((level) => level === resolved) ||
    `Choose a reasoning effort supported by ${provider}${metadata ? ` model ${metadata.value}` : ""}: ${supported.length ? supported.join(", ") : "use the provider runtime default"}.`
  );
}
