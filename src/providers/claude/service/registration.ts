import type { ProviderRegistration } from "../../../core/service/features/providers/registration.js";
import { claudeDefinition } from "../shared/definition.js";
import { claudeAbout } from "./configuration/about.js";
import { ClaudeAgentProvider } from "./runtime/provider.js";

export const claudeRegistration = {
  id: claudeDefinition.id,
  create: () => {
    const provider = new ClaudeAgentProvider(
      undefined,
      undefined,
      process.env.SUBAGENT_EXTENSION_FOR_CODEX_FULL_EVENTS === "1",
    );

    return Object.assign(provider, {
      about: async (refresh: boolean) =>
        claudeAbout(await provider.readiness({ refresh }), refresh),
    });
  },
} satisfies ProviderRegistration;
