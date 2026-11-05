import type { ProviderMetadata } from "../../../shared/providers/metadata.js";
import type {
  Capabilities,
  ModelChoice,
  ProviderPolicy,
  ProviderReadiness,
} from "../../../shared/providers/types.js";

export type Worker = {
  provider: string;
  metadata?: ProviderMetadata;
  profiles: string[];
  models?: ModelChoice[];
  model_discovery_error?: string;
  policy?: ProviderPolicy;
  readiness?: ProviderReadiness;
  capabilities: Partial<Capabilities>;
};
