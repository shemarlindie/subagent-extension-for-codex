import type { SettingsValues } from "../../../../shared/settings/settings-schema.js";
import type { Task } from "../../../../shared/tasks/model.js";
import type { Provider } from "../../providers/types.js";

type ModelEffort = Pick<Task, "model" | "reasoning_effort">;

/**
 * The model known not to support the chosen reasoning, if any. Unknown or
 * unavailable metadata leaves final validation to the provider.
 */
export async function modelRejectingEffort(
  provider: Provider,
  { model, reasoning_effort: effort }: ModelEffort,
  settings: SettingsValues,
) {
  if (!provider.models || !effort || effort === "default") return undefined;
  const models = await provider.models(settings).catch(() => []);
  const known = models.find((item) => item.value === (model || "default"));

  return known &&
    (known.supportsEffort === false ||
      (known.supportedEffortLevels !== undefined &&
        !known.supportedEffortLevels.includes(effort)))
    ? known.value
    : undefined;
}

/** Rejects reasoning the chosen model is known not to support. */
export async function assertModelEffort(
  provider: Provider,
  request: ModelEffort,
  settings: SettingsValues,
) {
  const model = await modelRejectingEffort(provider, request, settings);

  if (model) {
    throw new Error(
      `Model ${model} does not support ${request.reasoning_effort} reasoning`,
    );
  }
}
