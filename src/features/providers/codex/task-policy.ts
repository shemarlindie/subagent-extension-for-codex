import {
  executionTaskPolicy,
  type ProviderTaskPolicy,
} from "../task-policy.js";

export const codexTaskPolicy: ProviderTaskPolicy = {
  ...executionTaskPolicy,
  recoverBeforeInterrupt: true,
  // A retry starts a fresh native turn; the prior coordinator ID belongs to its session.
  retryOptions: () => ({}),
};
