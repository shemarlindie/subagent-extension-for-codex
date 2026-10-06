import type {
  Capabilities,
  ModelChoice,
} from "../../../src/features/providers/types.js";

export type Worker = {
  provider: string;
  profiles: string[];
  models?: ModelChoice[];
  model_discovery_error?: string;
  capabilities: Partial<Capabilities>;
};
