import { expect, test } from "vitest";

import { resolveModelDefaults } from "./model-defaults.js";

// Task resolution through every scope is covered by the settings integration
// tests. These cover the results only the panel and settings sections use.
const values = {
  models: {
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
    providerReasoning: undefined,
  });
});
