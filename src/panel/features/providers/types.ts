import type { ProviderMetadata } from "../../../shared/providers/metadata.js";
import type {
  Capabilities,
  ModelChoice,
  ProviderReadiness,
} from "../../../shared/providers/types.js";

export type Worker = {
  provider: string;
  metadata?: ProviderMetadata;
  profiles: string[];
  models?: ModelChoice[];
  model_discovery_error?: string;
  readiness?: ProviderReadiness;
  capabilities: Partial<Capabilities>;
};
