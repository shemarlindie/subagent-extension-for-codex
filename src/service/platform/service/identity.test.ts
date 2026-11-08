import assert from "node:assert/strict";

import { test } from "vitest";

import { handoff, type RunningService } from "./identity.js";

const own = { version: "0.2.0", apiVersion: 2 };
const origin = "http://127.0.0.1:17317";

const service = (fields: Partial<RunningService>): RunningService => ({
  version: "0.2.0",
  apiVersion: 2,
  launcher: "stdio",
  installed: true,
  ...fields,
});

test("replaces an uninstalled or API-changed plugin service of the same version", () => {
  assert.deepEqual(handoff(service({ installed: false }), own, origin), {
    action: "replace",
    forward: true,
  });

  assert.deepEqual(handoff(service({ apiVersion: 1 }), own, origin), {
    action: "replace",
    forward: false,
  });
});

test("never downgrades a newer plugin service", () => {
  assert.deepEqual(handoff(service({ version: "0.3.0" }), own, origin), {
    action: "use",
  });

  const refused = handoff(
    service({ version: "0.3.0", apiVersion: 3, installed: false }),
    own,
    origin,
  );

  assert.equal(refused.action, "refuse");

  assert.match(
    (refused as { message: string }).message,
    /newer extension service \(version 0\.3\.0\).*update the plugin/,
  );
});
