import { providerMetadata } from "../../../shared/providers/metadata";
import {
  aboveEffortCap,
  effortCap,
  effortCapReason,
  orgEffort,
} from "../../../shared/providers/policy";
import { resolveModelDefaults } from "../../../shared/settings/model-defaults";
import { reasoningLevels } from "../../../shared/tasks/reasoning";
import type { Defaults, Worker } from "../../app/state/types";
import { workerChoice } from "./delegation";

/**
 * What a worker choice inherits when its model and reasoning are left at
 * default: the profile's setting, then the provider's, then the org's
 * default or the global one. `providerModel` and `providerReasoning` skip the
 * profile's setting. The org's model is a name, as it has no value of its
 * own. The org's reasoning for the model that runs fills in last, where the
 * model supports it. Also returns the selected model's metadata and its
 * supported effort levels.
 */
export function modelDefaults(
  defaults: Defaults,
  workers: Worker[],
  worker: string,
  selectedModel: string,
) {
  const { provider, profile } = workerChoice(worker);
  const workerInfo = workers.find((item) => item.provider === provider);
  const policy = workerInfo?.policy;
  const saved = resolveModelDefaults(defaults, { provider, profile }, policy);

  // Blank runs Default, which is the org's model when it sets one.
  const runs = selectedModel.trim() || saved.model || "default";
  const metadata = workerInfo?.models?.find((item) => item.value === runs);

  const supported =
    metadata?.supportsEffort === false
      ? []
      : (metadata?.supportedEffortLevels ??
        providerMetadata(provider, workerInfo?.metadata)?.defaultEffortLevels ??
        reasoningLevels);

  const model = metadata?.resolvedModel ?? runs;
  const org = orgEffort(policy, model);
  const orgLevel = supported.find((level) => level === org);

  return {
    provider,
    model: saved.model ?? policy?.default_model?.name,
    reasoning: saved.reasoning_effort ?? orgLevel,
    providerModel: saved.providerModel,
    providerReasoning: saved.providerReasoning ?? orgLevel,
    workerInfo,
    metadata,
    supported,
    cap: effortCap(policy, model),
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
