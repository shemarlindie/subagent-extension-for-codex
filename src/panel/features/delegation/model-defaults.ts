import { providerMetadata } from "../../../shared/providers/metadata";
import {
  aboveEffortCap,
  effortCap,
  effortCapReason,
} from "../../../shared/providers/policy";
import { resolveModelDefaults } from "../../../shared/settings/model-defaults";
import { reasoningLevels } from "../../../shared/tasks/reasoning";
import type { Defaults, Worker } from "../../app/state/types";
import { workerChoice } from "./delegation";

/** The org's default model and reasoning, which outrank saved ones. */
export function orgDefaults(workers: Worker[], worker: string) {
  const { provider } = workerChoice(worker);
  const policy = workers.find((item) => item.provider === provider)?.policy;

  return {
    model: policy?.default_model,
    reasoning_effort: policy?.default_effort,
  };
}

/**
 * What a worker choice inherits when its model and reasoning are left at
 * default: the org's default, or the profile's setting, then the provider's,
 * then the global one. `providerModel` and `providerReasoning` skip the
 * profile's setting. The org's model is a name, as it has no value of its
 * own. Also returns the selected model's metadata and its supported effort
 * levels.
 */
export function modelDefaults(
  defaults: Defaults,
  workers: Worker[],
  worker: string,
  selectedModel: string,
) {
  const { provider, profile } = workerChoice(worker);
  const org = orgDefaults(workers, worker);
  const saved = resolveModelDefaults(defaults, { provider, profile });

  const model = org.model ?? saved.model;
  const reasoning = org.reasoning_effort ?? saved.reasoning_effort;
  const providerModel = org.model ?? saved.providerModel;
  const providerReasoning = org.reasoning_effort ?? saved.providerReasoning;

  const workerInfo = workers.find((item) => item.provider === provider);

  // Under the org's model, a blank choice runs Default.
  const inheritedValue = org.model ? undefined : saved.model;

  const runs = selectedModel.trim() || inheritedValue || "default";
  const metadata = workerInfo?.models?.find((item) => item.value === runs);

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
    providerModel,
    providerReasoning,
    workerInfo,
    metadata,
    supported,
    cap: effortCap(workerInfo?.policy, metadata?.resolvedModel ?? runs),
  };
}

/** Why a reasoning choice can't be used, or true when it can. */
export function validateReasoning(
  value: string,
  {
    provider,
    reasoning,
    metadata,
    supported,
    cap,
  }: ReturnType<typeof modelDefaults>,
) {
  const resolved = value === "default" ? reasoning : value;

  // Only a choice. Default inherits a saved effort, which Claude Code lowers.
  if (cap && aboveEffortCap(value, cap)) return effortCapReason(cap);

  return (
    !resolved ||
    supported.some((level) => level === resolved) ||
    `Choose a reasoning option supported by ${provider}${metadata ? ` model ${metadata.value}` : ""}: ${supported.length ? supported.join(", ") : "use the worker's default"}.`
  );
}
