import { expect, test } from "vitest";

import { resolveModelDefaults } from "./model-defaults.js";

// Task resolution through every scope is covered by the settings integration
// tests; these cover the results only the panel and settings sections use.
const values = {
  models: {
    global: { model: "global-model", reasoning_effort: "low" },
    providers: {
      claude: { model: "provider-model", reasoning_effort: "default" },
    },
    profiles: {
      reviewer: { model: "profile-model", reasoning_effort: "high" },
    },
  },
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
