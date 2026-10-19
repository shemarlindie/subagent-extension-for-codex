import type { Task } from "../../../../shared/tasks/model.js";
import type { Provider } from "../../providers/types.js";

/**
 * Rejects a reasoning effort the chosen model is known not to support.
 * Unknown or unavailable metadata leaves final validation to the provider.
 */
export async function assertModelEffort(
  provider: Provider,
  model: Task["model"],
  effort: Task["reasoning_effort"],
) {
  if (!provider.models || !effort || effort === "default") return;
  const models = await provider.models().catch(() => []);
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
