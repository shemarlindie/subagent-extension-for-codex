import type { EventPayloadMap } from "../../../../shared/events/event-contract.js";
import { optionsForProvider } from "../../../../shared/providers/options.js";
import {
  aboveEffortCap,
  blockedReason,
  effortCap,
  effortCapReason,
  modelAllowed,
  resolvedModel,
} from "../../../../shared/providers/policy.js";
import type { ProviderPolicy } from "../../../../shared/providers/types.js";
import { resolveModelDefaults } from "../../../../shared/settings/model-defaults.js";
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

/** Which choices a start request makes itself, as opposed to saved defaults. */
export type Requested = { model: boolean; effort: boolean };

/**
 * The model and effort a start runs, with the org's defaults in place of the
 * global ones. The request's own choices and saved profile and provider
 * defaults still win.
 */
function withOrgDefaults(
  provider: Provider,
  input: Start,
  defaults: SettingsValues,
  policy: ProviderPolicy | undefined,
  requested: Requested,
) {
  const saved = resolveModelDefaults(
    defaults,
    { provider: input.provider, profile: input.worker_profile },
    policy,
  );

  const model = requested.model ? input.model : saved.model;

  const reasoning_effort = requested.effort
    ? input.reasoning_effort
    : // Settings validation keeps saved levels to the known ones.
      (saved.reasoning_effort as Start["reasoning_effort"]);

  if (model !== input.model || reasoning_effort !== input.reasoning_effort) {
    logEvent("info", "provider.policy_default_applied", {
      provider: provider.id,
      saved_model: model === input.model ? undefined : input.model,
      saved_effort:
        reasoning_effort === input.reasoning_effort
          ? undefined
          : input.reasoning_effort,
    });
  }

  return { model, reasoning_effort };
}

/**
 * Fits a start request to org policy. A choice the request makes itself fails
 * with the reason, so whoever asked can act on it. Saved defaults give way to
 * the org's. A saved model no longer allowed gives way to the default with a
 * note, since nobody asked for it just now. A saved mode needs nothing here:
 * Claude Code falls back itself, and the provider reports it. Without discovery
 * there's nothing to check against, and tasks are still checked as they run.
 */
export async function checkStartPolicy(
  provider: Provider,
  input: Start,
  defaults: SettingsValues,
  requested: Requested,
): Promise<
  Pick<Start, "model" | "reasoning_effort"> & {
    limited?: EventPayloadMap["agent.limited"];
  }
> {
  const mode = explicitMode(provider, input);
  const { model, reasoning_effort } = input;

  if (
    !provider.policy ||
    (!mode && !model && (!reasoning_effort || reasoning_effort === "default"))
  ) {
    return { model, reasoning_effort };
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

  const start = withOrgDefaults(provider, input, defaults, policy, requested);
  const models = (await provider.models?.(defaults).catch(() => [])) ?? [];

  const excluded = !!start.model && !modelAllowed(policy, models, start.model);

  if (excluded && requested.model) {
    throw reject("model", start.model!, MODEL_NOT_ALLOWED);
  }

  const fitted = excluded
    ? { ...start, model: undefined, limited: modelLimit(start.model!) }
    : start;

  // A saved effort above the cap starts, and Claude Code lowers it.
  const effort = fitted.reasoning_effort ?? "";
  const cap = effortCap(policy, resolvedModel(models, fitted.model));

  if (requested.effort && cap && aboveEffortCap(effort, cap)) {
    throw reject("reasoning_effort", effort, effortCapReason(cap));
  }

  return fitted;
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
