import { registerProviders } from "../../core/shared/providers/registry.js";
import { claudeDefinition } from "../../providers/claude/shared/definition.js";
import { fixtureDefinition } from "../../providers/fixture/shared/definition.js";
import { mount } from "./bootstrap";

registerProviders([claudeDefinition, fixtureDefinition]);

mount();
