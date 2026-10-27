import assert from "node:assert/strict";

import { test } from "vitest";

import { FixtureProvider } from "../../../../dev/service/fixture-provider.js";
import { assertSelectedProviderOptions } from "../../../shared/providers/options.js";
import { startSchema, type Task } from "../../../shared/tasks/model.js";
import { Settings } from "../settings/settings.js";
import { Store } from "../tasks/storage/store.js";
import { executionTaskPolicy } from "./task-policy.js";

const task = (approval_mode: Task["approval_mode"]) =>
  ({ approval_mode }) as Task;

test("execution policy separates automatic permission decisions from questions and parent authorization", () => {
  assert.equal(
    executionTaskPolicy.decideInput(task("auto_approve"), "Bash"),
    true,
  );

  assert.equal(executionTaskPolicy.decideInput(task("deny"), "Bash"), false);

  for (const mode of ["ask_user", "parent_agent"] as const) {
    assert.equal(
      executionTaskPolicy.decideInput(task(mode), "Bash"),
      undefined,
    );
  }

  for (const mode of ["auto_approve", "deny", "parent_agent"] as const) {
    assert.equal(
      executionTaskPolicy.decideInput(task(mode), "AskUserQuestion"),
      undefined,
    );
  }

  assert.equal(
    executionTaskPolicy.parentMayApprove(task("parent_agent")),
    true,
  );

  assert.equal(
    executionTaskPolicy.parentMayApprove(task("auto_approve")),
    false,
  );
});

test("execution policy prevents parent escalation but lets users choose approval authority", () => {
  const store = new Store(":memory:");

  try {
    const defaults = new Settings(store.database, () => ["fixture"]).values(
      "alice",
    );

    defaults.approvals.execution_mode = "ask_user";

    const input = startSchema.parse({
      repository: "/repo",
      description: "Check",
      approval_mode: "auto_approve",
    });

    assert.throws(
      () =>
        executionTaskPolicy.prepareStart({
          input,
          defaults,
          authority: "parent",
        }),
      /exceeds the user-approved default/,
    );

    assert.deepEqual(
      executionTaskPolicy.prepareStart({ input, defaults, authority: "user" }),
      { approval_mode: "auto_approve" },
    );

    assert.deepEqual(
      executionTaskPolicy.prepareStart({
        input: { ...input, approval_mode: "deny" },
        defaults,
        authority: "parent",
      }),
      { approval_mode: "deny" },
    );

    defaults.approvals.execution_mode = "parent_agent";

    assert.deepEqual(
      executionTaskPolicy.prepareStart({
        input: { ...input, approval_mode: undefined },
        defaults,
        authority: "parent",
      }),
      { approval_mode: "parent_agent" },
    );
  } finally {
    store.close();
  }
});

test("task options are isolated to the selected provider namespace", () => {
  const input = {
    repository: "/repo",
    description: "Check",
    provider: "new-built-in",
    provider_options: {
      "new-built-in": { pool: "isolated" },
    },
  };

  assert.deepEqual(startSchema.parse(input).provider_options, {
    "new-built-in": { pool: "isolated" },
  });

  assert.doesNotThrow(() =>
    assertSelectedProviderOptions(input.provider, input.provider_options),
  );

  assert.throws(
    () =>
      assertSelectedProviderOptions("new-built-in", {
        claude: { permission_mode: "plan" },
      }),
    /selected provider/,
  );
});

test("fixture instances do not share mutable capabilities", () => {
  const first = new FixtureProvider();
  const second = new FixtureProvider();

  first.capabilities.cost_budget = false;
  assert.equal(second.capabilities.cost_budget, true);
});
