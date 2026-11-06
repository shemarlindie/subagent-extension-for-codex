import type {
  ModelChoice,
  ProviderPolicy,
  ProviderReadiness,
} from "../../../../shared/providers/types.js";
import type { SettingsValues } from "../../../../shared/settings/settings-schema.js";
import type { Provider } from "../../providers/types.js";

type WorkerStatus = {
  readiness?: ProviderReadiness;
  models?: ModelChoice[];
  policy?: ProviderPolicy;
  model_discovery_error?: string;
};

/** A worker with what its provider reports now: readiness, models and policy. */
export async function workerStatus<W extends object>(
  worker: W,
  provider: Provider,
  settings: SettingsValues,
): Promise<W & WorkerStatus> {
  const readiness = await provider.readiness?.();
  const known = readiness ? { ...worker, readiness } : worker;
  // Model discovery launches the runtime, so it waits until that is ready.
  if (!provider.models || readiness?.ready === false) return known;

  try {
    const [models, policy] = await Promise.all([
      provider.models(settings),
      provider.policy?.(settings),
    ]);

    return { ...known, models, ...(policy ? { policy } : {}) };
  } catch {
    return {
      ...known,
      model_discovery_error:
        "Model discovery unavailable; enter a model ID or retry later.",
    };
  }
}
