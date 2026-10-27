import { expect, test } from "vitest";

import { resolveModelDefaults } from "./model-defaults.js";

// Task resolution through every scope is covered by the settings integration
// tests; these cover the results only the panel and settings sections use.
const values = {
  default_model: "global-model",
  default_reasoning_effort: "low",
  claude_default_model: "provider-model",
  claude_default_reasoning_effort: "default",
  reviewer_default_model: "profile-model",
  reviewer_default_reasoning_effort: "high",
};

test("provider results skip the profile scope", () => {
  expect(
    resolveModelDefaults(values, { provider: "claude", profile: "reviewer" }),
  ).toEqual({
    model: "profile-model",
    reasoning_effort: "high",
    providerModel: "provider-model",
    providerReasoning: "low",
  });
});

test("omitted scopes are skipped", () => {
  expect(resolveModelDefaults(values, {}).model).toBe("global-model");

  expect(
    resolveModelDefaults(values, { profile: "reviewer" }).providerModel,
  ).toBe("global-model");
});
