import assert from "node:assert/strict";

import { test } from "vitest";

import { blockedReason, modelAllowed } from "./policy.js";
import type { ProviderPolicy } from "./types.js";

const models = [
  {
    value: "haiku",
    resolvedModel: "claude-haiku-5-5",
    displayName: "Haiku",
    description: "",
  },
];

const policy = (
  available_models: string[],
  available_models_match: "prefix" | "exact" = "prefix",
): ProviderPolicy => ({
  managed: true,
  blocked: [
    {
      setting: "permission_mode",
      value: "auto",
      reason: "Turned off by your organization",
    },
  ],
  available_models,
  available_models_match,
  notes: [],
});

test("without an allowlist or a named model, every model passes", () => {
  assert.ok(modelAllowed(undefined, [], "claude-opus-5-5"));
  assert.ok(modelAllowed(policy(["haiku"]), models, ""));
  assert.ok(modelAllowed(policy(["haiku"]), models, "default"));
});

test("listed aliases and the IDs they resolve to pass, and excluded models don't", () => {
  const limited = policy(["haiku"]);

  assert.ok(modelAllowed(limited, models, "haiku"));
  assert.ok(modelAllowed(limited, models, "haiku[1m]"));
  assert.ok(modelAllowed(limited, models, "claude-haiku-5-5"));
  assert.ok(modelAllowed(limited, [], "claude-haiku-4-5"));
  assert.ok(!modelAllowed(limited, models, "opus"));
  assert.ok(!modelAllowed(limited, models, "claude-opus-5-5"));
});

test("a model ID entry covers its later versions by prefix, and only its own IDs when exact", () => {
  const prefix = policy(["claude-opus-5"]);
  assert.ok(modelAllowed(prefix, [], "claude-opus-5-5"));
  assert.ok(!modelAllowed(prefix, [], "claude-sonnet-5-5"));

  const exact = policy(["claude-opus-5"], "exact");
  assert.ok(modelAllowed(exact, [], "claude-opus-5"));
  assert.ok(modelAllowed(exact, [], "claude-opus-5-20260101"));
  assert.ok(modelAllowed(exact, [], "claude-opus-5-fast"));
  assert.ok(!modelAllowed(exact, [], "claude-opus-5-5"));
});

test("a blocked choice gives its reason", () => {
  assert.equal(
    blockedReason(policy([]), "permission_mode", "auto"),
    "Turned off by your organization",
  );

  assert.equal(blockedReason(policy([]), "permission_mode", "plan"), undefined);
  assert.equal(blockedReason(undefined, "permission_mode", "auto"), undefined);
});
