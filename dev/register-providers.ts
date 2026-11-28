import { registerProviders } from "../src/core/shared/providers/registry.js";
import { claudeDefinition } from "../src/providers/claude/shared/definition.js";
import { fixtureDefinition } from "../src/providers/fixture/shared/definition.js";

registerProviders([claudeDefinition, fixtureDefinition]);
