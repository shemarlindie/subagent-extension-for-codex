// Development-only service entry for `npm run demo`: the real service with the
// fixture worker in place of Claude, so tasks make no model calls.
// Run with tsx; it is outside src/ and never ships.
import { serve } from "../../src/service/platform/service/serve.js";
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
  readiness: choice(process.env.CODEX_SUBAGENT_EXTENSION_FIXTURE_READINESS, [
    "ready",
    "unavailable",
    "error",
  ]),
  readinessDelayMs: delay(
    process.env.CODEX_SUBAGENT_EXTENSION_FIXTURE_READINESS_DELAY_MS,
  ),
  models: choice(process.env.CODEX_SUBAGENT_EXTENSION_FIXTURE_MODELS, [
    "default",
    "empty",
    "error",
    "error-once",
  ]),
  modelsDelayMs: delay(
    process.env.CODEX_SUBAGENT_EXTENSION_FIXTURE_MODELS_DELAY_MS,
  ),
  deleteSessionError:
    process.env.CODEX_SUBAGENT_EXTENSION_FIXTURE_DELETE_SESSION === "error",
  closeError: process.env.CODEX_SUBAGENT_EXTENSION_FIXTURE_CLOSE === "error",
};

await serve({
  providers: () => new Map([["fixture", new FixtureProvider(options)]]),
});
