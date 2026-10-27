import type { SettingsValues } from "../../../../shared/settings/settings-schema.js";
import type { Task } from "../../../../shared/tasks/model.js";
import type { Provider } from "../../providers/types.js";

/**
 * Rejects a reasoning effort the chosen model is known not to support.
 * Unknown or unavailable metadata leaves final validation to the provider.
 */
export async function assertModelEffort(
  provider: Provider,
  { model, reasoning_effort: effort }: Pick<Task, "model" | "reasoning_effort">,
  settings: SettingsValues,
) {
  if (!provider.models || !effort || effort === "default") return;
  const models = await provider.models(settings).catch(() => []);
  const known = models.find((item) => item.value === (model || "default"));

  if (
    known &&
    (known.supportsEffort === false ||
      (known.supportedEffortLevels !== undefined &&
        !known.supportedEffortLevels.includes(effort)))
  ) {
    throw new Error(
      `Model ${known.value} does not support reasoning effort ${effort}`,
    );
  }
}
