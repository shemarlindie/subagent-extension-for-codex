import { ClaudeAgentProvider } from "./claude/runtime/provider.js";
import type { Provider } from "./types.js";

/** Constructing a provider does not make API requests. */
export function configuredProviders(fullEvents = false) {
  return new Map<string, Provider>([
    [
      "claude",
      new ClaudeAgentProvider(undefined, undefined, undefined, fullEvents),
    ],
  ]);
}
