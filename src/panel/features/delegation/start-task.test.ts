import assert from "node:assert/strict";

import { test } from "vitest";

import type { DelegateValues } from "./delegate-values";
import { startTaskArguments } from "./start-task";

test("a blocked mode submits as the fallback", () => {
  const input = startTaskArguments(
    {
      permission_mode: "bypassPermissions",
      approval_decider: "user",
      worker: "claude:implementer",
      model: "",
      context: "",
      deps: [],
      runtimeMode: "none",
      costMode: "none",
    } as unknown as DelegateValues,
    [
      {
        provider: "claude",
        profiles: [],
        capabilities: {},
        policy: {
          managed: true,
          blocked: [
            {
              value: "bypassPermissions",
              reason: "Turned off by your organization",
            },
          ],
          notes: [],
        },
      },
    ],
    undefined,
  );

  assert.equal(input.provider_options?.claude?.permission_mode, "default");
});
