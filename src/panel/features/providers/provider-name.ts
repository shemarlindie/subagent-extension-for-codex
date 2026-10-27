import { providerMetadata } from "../../../shared/providers/metadata.js";
import type { Worker } from "./types";

/** The provider's display name, or its id before its worker reports one. */
export function providerName(provider: string, workers: Worker[]) {
  return (
    providerMetadata(
      provider,
      workers.find((worker) => worker.provider === provider)?.metadata,
    )?.displayName ?? provider
  );
}
