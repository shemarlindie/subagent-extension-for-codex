import type { Provider } from "../../shared/contracts.js";
import { ClaudeAgentProvider } from "./claude/provider.js";

/** Constructing a provider does not make API requests. */
export function configuredProviders() {
  return new Map<string, Provider>([["claude", new ClaudeAgentProvider()]]);
}
