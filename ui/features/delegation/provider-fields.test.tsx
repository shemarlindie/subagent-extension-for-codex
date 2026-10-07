// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { test } from "vitest";

import type { Worker } from "../providers/types";
import {
  ApprovalField,
  BudgetFields,
  type DelegateValues,
} from "./delegate-fields";
import { providerOptionDefaults } from "./provider-defaults";

function ProviderFields({ worker }: { worker: Worker }) {
  const form = useForm<DelegateValues>({
    defaultValues: {
      worker: `${worker.provider}:reviewer`,
      permission_mode: "inherit",
      approval_decider: "user",
      costMode: "limited",
      runtimeMode: "limited",
    },
  });

  return (
    <FormProvider {...form}>
      <ApprovalField workers={[worker]} />
      <BudgetFields workers={[worker]} />
    </FormProvider>
  );
}

test("an unfamiliar worker supplies its native permissions and budget presentation", (t) => {
  t.onTestFinished(cleanup);

  const view = render(
    <ProviderFields
      worker={{
        provider: "new-built-in",
        profiles: ["reviewer"],
        capabilities: { cost_budget: true },
        metadata: {
          displayName: "New built-in",
          costBudgetHelp: "Costs are metered before each request.",
          nativePermissions: {
            permissionOption: "mode",
            permissionSetting: "new_mode",
            approvalDeciderOption: "decider",
            approvalDeciderSetting: "new_decider",
            options: [{ value: "inherit", label: "Runtime policy" }],
            help: "Use the provider's own native policy.",
            approvalDecider: true,
            approvalDeciderHelp:
              "Who answers this provider's permission requests.",
          },
        },
      }}
    />,
  );

  assert.match(view.container.textContent ?? "", /Runtime policy/);

  assert.match(
    view.container.textContent ?? "",
    /Use the provider's own native policy/,
  );

  assert.match(
    view.container.textContent ?? "",
    /Who answers this provider's permission requests/,
  );

  assert.match(
    view.container.textContent ?? "",
    /Costs are metered before each request/,
  );
});

test("workers without native mode selection do not offer approval delegation", (t) => {
  t.onTestFinished(cleanup);

  const view = render(
    <ProviderFields
      worker={{
        provider: "new-built-in",
        profiles: ["reviewer"],
        capabilities: {},
        metadata: { displayName: "New built-in" },
      }}
    />,
  );

  assert.equal(view.container.querySelector("#approval-decider"), null);

  assert.match(
    view.container.textContent ?? "",
    /This provider requires No cost limit/,
  );
});

test("provider option defaults read the setting keys declared by metadata", () => {
  assert.deepEqual(
    providerOptionDefaults(
      "new-built-in",
      {
        displayName: "New built-in",
        nativePermissions: {
          permissionOption: "mode",
          permissionSetting: "new_mode",
          approvalDeciderOption: "decider",
          approvalDeciderSetting: "new_decider",
          options: [{ value: "locked", label: "Locked" }],
          help: "Provider permissions.",
          approvalDecider: true,
        },
      },
      { new_mode: "locked", new_decider: "parent_agent" },
    ),
    { permission_mode: "locked", approval_decider: "parent_agent" },
  );
});
