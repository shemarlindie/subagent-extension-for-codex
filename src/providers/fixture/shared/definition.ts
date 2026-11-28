import type { ProviderDefinition } from "../../../core/shared/providers/registry.js";

export const fixtureDefinition = {
  id: "fixture",
  metadata: { displayName: "Fixture", cliName: "Fixture" },
} satisfies ProviderDefinition;
