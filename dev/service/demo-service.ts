// Development-only service entry for `npm run demo`: the real service with the
// fixture worker in place of Claude, so tasks make no model calls.
// Run with tsx; it is outside src/ and never ships.
import { serve } from "../../src/core/service/platform/service/serve.js";
import { codexHost } from "../../src/hosts/codex/service/host.js";

import "../register-providers.js";

import { fixtureDefinition } from "../../src/providers/fixture/shared/definition.js";
import {
  FixtureProvider,
  type FixtureProviderOptions,
} from "./fixture-provider.js";

function choice<T extends string>(value: string | undefined, values: T[]) {
  return values.find((item) => item === value);
}

function delay(value: string | undefined) {
  const milliseconds = Number(value);

  return Number.isSafeInteger(milliseconds)
    ? Math.max(0, Math.min(milliseconds, 60_000))
    : 0;
}

const options: FixtureProviderOptions = {
  readiness: choice(
    process.env.SUBAGENT_EXTENSION_FOR_CODEX_FIXTURE_READINESS,
    ["ready", "unavailable", "error"],
  ),
  readinessDelayMs: delay(
    process.env.SUBAGENT_EXTENSION_FOR_CODEX_FIXTURE_READINESS_DELAY_MS,
  ),
  models: choice(process.env.SUBAGENT_EXTENSION_FOR_CODEX_FIXTURE_MODELS, [
    "default",
    "empty",
    "error",
    "error-once",
  ]),
  modelsDelayMs: delay(
    process.env.SUBAGENT_EXTENSION_FOR_CODEX_FIXTURE_MODELS_DELAY_MS,
  ),
  deleteSessionError:
    process.env.SUBAGENT_EXTENSION_FOR_CODEX_FIXTURE_DELETE_SESSION === "error",
  closeError:
    process.env.SUBAGENT_EXTENSION_FOR_CODEX_FIXTURE_CLOSE === "error",
};

await serve({
  host: codexHost,
  registrations: [
    {
      id: fixtureDefinition.id,
      create: () => new FixtureProvider(options),
    },
  ],
});
