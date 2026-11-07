import type { EventPayloadMap } from "../../../../shared/events/event-contract.js";
import { optionsForProvider } from "../../../../shared/providers/options.js";
import {
  blockedReason,
  modelAllowed,
} from "../../../../shared/providers/policy.js";
import type { SettingsValues } from "../../../../shared/settings/settings-schema.js";
import type { Start, Task } from "../../../../shared/tasks/model.js";
import { PolicyRejectedError } from "../../../platform/logging/error-metadata.js";
import { logEvent } from "../../../platform/logging/logger.js";
import type { Provider } from "../../providers/types.js";
import { modelRejectingEffort } from "./model-effort.js";

const MODEL_NOT_ALLOWED = "Your organization doesn't allow this model.";

const modelLimit = (model: string): EventPayloadMap["agent.limited"] => ({
  setting: "model",
  requested: model,
  effective: "default",
  reason: `Running with the default model. Your organization doesn't allow ${model}.`,
});

/** Whether a start request names an effort itself. `default` inherits the saved one. */
export function effortRequested(input: unknown) {
  const { reasoning_effort: effort } = input as { reasoning_effort?: unknown };

  return !!effort && effort !== "default";
}

/** The mode a request names itself, as opposed to the saved default it inherits. */
function explicitMode(provider: Provider, input: Start) {
  const option = provider.metadata?.nativePermissions?.permissionOption;
  if (!option) return undefined;

  const mode = optionsForProvider(input.provider_options, provider.id)[option];

  return typeof mode === "string" && mode !== "inherit" ? mode : undefined;
}

/**
 * Fits a start request to org policy. A choice the request makes itself fails
 * with the reason, so whoever asked can act on it. A saved model no longer
 * allowed gives way to the default with a note, since nobody asked for it just
 * now. A saved mode needs nothing here: Claude Code falls back itself, and the
 * provider reports it. Without discovery there's nothing to check against, and
 * tasks are still checked as they run.
 */
export async function checkStartPolicy(
  provider: Provider,
  input: Start,
  defaults: SettingsValues,
  modelRequested: boolean,
): Promise<{
  model: string | undefined;
  limited?: EventPayloadMap["agent.limited"];
}> {
  const mode = explicitMode(provider, input);

  if (!provider.policy || (!mode && !input.model)) {
    return { model: input.model };
  }

  const policy = await provider.policy(defaults).catch(() => undefined);
  const reason = mode && blockedReason(policy, mode);

  const reject = (setting: string, value: string, why: string, text = why) => {
    logEvent("warn", "provider.policy_rejected", {
      provider: provider.id,
      setting,
      value,
      reason: why,
    });

    return new PolicyRejectedError(text);
  };

  if (reason) {
    throw reject(
      "permission_mode",
      mode,
      reason,
      `Can't use permission mode ${mode}: ${reason}.`,
    );
  }

  const models = (await provider.models?.(defaults).catch(() => [])) ?? [];

  if (!input.model || modelAllowed(policy, models, input.model)) {
    return { model: input.model };
  }

  if (modelRequested) throw reject("model", input.model, MODEL_NOT_ALLOWED);

  return {
    model: undefined,
    limited: modelLimit(input.model),
  };
}

/**
 * Moves a task to the default model when policy has excluded its model since it
 * started, because Claude Code can run an excluded model it's asked for. Returns
 * the note to show. The session's history carries over.
 */
export async function limitTurnModel(
  provider: Provider,
  t: Task,
  defaults: SettingsValues,
) {
  if (!t.model || !provider.policy) return undefined;

  const policy = await provider.policy(defaults).catch(() => undefined);
  const models = (await provider.models?.(defaults).catch(() => [])) ?? [];

  if (modelAllowed(policy, models, t.model)) return undefined;

  const limited = modelLimit(t.model);
  delete t.model;

  if (await modelRejectingEffort(provider, t, defaults)) {
    delete t.reasoning_effort;
  }

  return limited;
}
