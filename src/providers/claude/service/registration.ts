import type { ProviderRegistration } from "../../../core/service/features/providers/registration.js";
import { claudeDefinition } from "../shared/definition.js";
import { ClaudeAgentProvider } from "./runtime/provider.js";

export const claudeRegistration = {
  id: claudeDefinition.id,
  create: () =>
    new ClaudeAgentProvider(
      undefined,
      undefined,
      process.env.SUBAGENT_EXTENSION_FOR_CODEX_FULL_EVENTS === "1",
    ),
} satisfies ProviderRegistration;
