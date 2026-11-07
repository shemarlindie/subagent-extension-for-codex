import assert from "node:assert/strict";

import { test } from "vitest";

import { modelAllowed } from "./policy.js";
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
  blocked: [],
  available_models,
  available_models_match,
  notes: [],
});

test("listed aliases and the IDs they resolve to pass, and excluded models don't", () => {
  const limited = policy(["haiku"]);

  assert.ok(modelAllowed(limited, models, "haiku"));
  assert.ok(modelAllowed(limited, models, "haiku[1m]"));

  assert.ok(
    modelAllowed(
      policy(["claude-opus-5-5"]),
      [{ value: "opus[1m]", displayName: "Opus", description: "" }],
      "opus[1m]",
    ),
    "an offered model is allowed under the value the catalog gives it",
  );

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
