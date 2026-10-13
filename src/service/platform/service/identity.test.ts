import assert from "node:assert/strict";

import { test } from "vitest";

import {
  compareVersions,
  handoff,
  type RunningService,
  serviceIdentity,
} from "./identity.js";
import { installRoot, packageVersion } from "./runtime.js";

const own = { version: "0.2.0", apiVersion: 2, installRoot: "/plugins/0.2.0" };
const origin = "http://127.0.0.1:17317";

const service = (fields: Partial<RunningService>): RunningService => ({
  version: "0.2.0",
  apiVersion: 2,
  launcher: "stdio",
  installRoot: "/plugins/0.2.0",
  installed: true,
  ...fields,
});

test("compares release versions numerically", () => {
  assert.equal(compareVersions("0.10.0", "0.9.9"), 1);
  assert.equal(compareVersions("1.2", "1.2.0"), 0);
  assert.equal(compareVersions("1.2.3-beta.1", "1.2.3"), 0);
  assert.equal(compareVersions("1.2.3", "1.3.0"), -1);
});

test("reports this installation, and only the stdio launcher marks its services", () => {
  assert.deepEqual(serviceIdentity({}), {
    version: packageVersion,
    apiVersion: 1,
    launcher: "foreground",
    installRoot,
  });

  assert.equal(
    serviceIdentity({ CODEX_SUBAGENT_EXTENSION_LAUNCHER: "stdio" }).launcher,
    "stdio",
  );
});

test("uses a current plugin service", () => {
  assert.deepEqual(handoff(service({}), own, origin), { action: "use" });
});

test("replaces an older or uninstalled plugin service, forwarding while it speaks the same API", () => {
  assert.deepEqual(handoff(service({ version: "0.1.0" }), own, origin), {
    action: "replace",
    forward: true,
  });

  assert.deepEqual(
    handoff(service({ version: "0.1.0", apiVersion: 1 }), own, origin),
    { action: "replace", forward: false },
  );

  assert.deepEqual(handoff(service({ installed: false }), own, origin), {
    action: "replace",
    forward: true,
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

test("never replaces a service it didn't start", () => {
  for (const running of [
    service({ launcher: "foreground", version: "0.1.0" }),
    service({ launcher: "foreground", installed: false }),
  ])
    assert.deepEqual(handoff(running, own, origin), { action: "use" });

  // Services from before identities report no launcher or API version.
  for (const running of [
    service({ launcher: "foreground", apiVersion: 1 }),
    { installed: true },
  ]) {
    const refused = handoff(running, own, origin);
    assert.equal(refused.action, "refuse");

    assert.match(
      (refused as { message: string }).message,
      /different extension service .* not started by the plugin\) is running at http:\/\/127\.0\.0\.1:17317/,
    );
  }
});
