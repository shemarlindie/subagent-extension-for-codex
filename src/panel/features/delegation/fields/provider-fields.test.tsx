// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, waitFor } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { expect, test } from "vitest";

import type { Worker } from "../../providers/types";
import type { DelegateValues } from "../delegate-values";
import { providerOptionDefaults } from "../provider-defaults";
import { ApprovalField } from "./approval-field";
import { BudgetFields } from "./budget-fields";

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

test("a blocked mode left in the form becomes the mode that would run", async (t) => {
  t.onTestFinished(cleanup);

  const worker: Worker = {
    provider: "claude",
    profiles: ["reviewer"],
    capabilities: {},
    policy: {
      managed: true,
      blocked: [
        {
          value: "auto",
          reason: "Turned off by your organization",
        },
      ],
      notes: [],
    },
  };

  let mode: string | undefined;

  function Form() {
    const form = useForm<DelegateValues>({
      defaultValues: {
        worker: "claude:reviewer",
        permission_mode: "auto",
        approval_decider: "user",
      },
    });

    mode = form.watch("permission_mode");

    return (
      <FormProvider {...form}>
        <ApprovalField workers={[worker]} />
      </FormProvider>
    );
  }

  render(<Form />);

  await waitFor(() => assert.equal(mode, "default"));
});

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
            permissionSetting: "providers.new_built_in.mode",
            approvalDeciderOption: "decider",
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

  expect(view.container.querySelector("#approval-decider")).toBeNull();

  assert.match(
    view.container.textContent ?? "",
    /This provider requires No cost limit/,
  );
});

test("provider option defaults read the provider's permission and sandbox settings and the shared decider", () => {
  const nativePermissions = {
    permissionOption: "mode",
    permissionSetting: "providers.new_built_in.mode",
    approvalDeciderOption: "decider",
    sandbox: {
      option: "sandbox",
      setting: "providers.new_built_in.sandbox",
      help: "Sandbox.",
    },
    options: [{ value: "locked", label: "Locked" }],
    help: "Provider permissions.",
    approvalDecider: true,
  };

  const settings = {
    providers: { new_built_in: { mode: "locked", sandbox: true } },
    approvals: { decider: "parent_agent" },
  };

  assert.deepEqual(
    providerOptionDefaults(
      "new-built-in",
      { displayName: "New built-in", nativePermissions },
      settings,
    ),
    {
      permission_mode: "locked",
      sandbox: "on",
      approval_decider: "parent_agent",
    },
  );

  // Providers without approval delegation keep the user as decider, and
  // those without a sandbox leave it off.
  assert.deepEqual(
    providerOptionDefaults(
      "new-built-in",
      {
        displayName: "New built-in",
        nativePermissions: {
          ...nativePermissions,
          approvalDecider: false,
          sandbox: undefined,
        },
      },
      settings,
    ),
    { permission_mode: "locked", sandbox: "off", approval_decider: "user" },
  );
});

test("known budget selections stay visible while workers finish loading", (t) => {
  t.onTestFinished(cleanup);

  function Fields() {
    const form = useForm<DelegateValues>({
      defaultValues: {
        workspace_strategy: "worktree",
        worker: "claude:reviewer",
        costMode: "limited",
        cost: 4,
        runtimeMode: "limited",
        runtime: 20,
      },
    });

    return (
      <FormProvider {...form}>
        <BudgetFields workers={[]} settingsReady workersReady={false} />
      </FormProvider>
    );
  }

  const view = render(<Fields />);
  const costMode = view.getByRole("switch", { name: "Cost limit" });
  const cost = view.container.querySelector<HTMLInputElement>("#cost");

  assert.equal(costMode.getAttribute("aria-disabled"), "true");
  assert.equal(costMode.getAttribute("aria-busy"), null);
  assert.equal(costMode.getAttribute("aria-checked"), "true");
  assert.equal(cost?.disabled, true);
});
