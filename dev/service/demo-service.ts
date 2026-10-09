// Development-only service entry for `npm run demo`: the real service with the
// fixture worker in place of Claude, so tasks make no model calls.
// Run with tsx; it is outside src/ and never ships.
import { serve } from "../../src/service/platform/service/serve.js";
import { FixtureProvider } from "./fixture-provider.js";

await serve({
  providers: () => new Map([["fixture", new FixtureProvider()]]),
});
