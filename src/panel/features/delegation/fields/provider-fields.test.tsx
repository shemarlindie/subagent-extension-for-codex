// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { expect, test } from "vitest";

import type { Worker } from "../../providers/types";
import type { DelegateValues } from "../delegate-values";
import { providerOptionDefaults } from "../provider-defaults";
import { ApprovalField } from "./approval-field";
import { BudgetFields } from "./budget-fields";
import { WorkspaceField } from "./workspace-field";

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

test("permission fields stay unresolved until worker metadata arrives", (t) => {
  t.onTestFinished(cleanup);

  function Fields() {
    const form = useForm<DelegateValues>({
      defaultValues: {
        worker: "",
        permission_mode: "inherit",
        approval_decider: "user",
      },
    });

    return (
      <FormProvider {...form}>
        <ApprovalField workers={[]} disabled loading />
      </FormProvider>
    );
  }

  const view = render(<Fields />);

  for (const id of ["permission-mode", "approval-decider"]) {
    const control = view.container.querySelector<HTMLButtonElement>(`#${id}`);

    assert.ok(control?.disabled);
    assert.equal(control?.getAttribute("aria-busy"), "true");
    assert.match(control?.textContent ?? "", /Loading…/);
  }

  assert.doesNotMatch(view.container.textContent ?? "", /Inherit|Parent agent/);
});

test("provider option defaults read the provider's permission setting and the shared decider", () => {
  const nativePermissions = {
    permissionOption: "mode",
    permissionSetting: "providers.new_built_in.mode",
    approvalDeciderOption: "decider",
    options: [{ value: "locked", label: "Locked" }],
    help: "Provider permissions.",
    approvalDecider: true,
  };

  const settings = {
    providers: { new_built_in: { mode: "locked" } },
    approvals: { decider: "parent_agent" },
  };

  assert.deepEqual(
    providerOptionDefaults(
      "new-built-in",
      { displayName: "New built-in", nativePermissions },
      settings,
    ),
    { permission_mode: "locked", approval_decider: "parent_agent" },
  );

  // Providers without approval delegation keep the user as decider.
  assert.deepEqual(
    providerOptionDefaults(
      "new-built-in",
      {
        displayName: "New built-in",
        nativePermissions: { ...nativePermissions, approvalDecider: false },
      },
      settings,
    ),
    { permission_mode: "locked", approval_decider: "user" },
  );
});

test("unknown task defaults show in-control loading text until selected values resolve", (t) => {
  t.onTestFinished(cleanup);

  function Fields() {
    const form = useForm<DelegateValues>({
      defaultValues: {
        workspace_strategy: "",
        worker: "",
        costMode: "",
        cost: "",
        runtimeMode: "",
        runtime: "",
      },
    });

    return (
      <FormProvider {...form}>
        <WorkspaceField settingsReady={false} settingsLoading />
        <BudgetFields
          workers={[]}
          settingsReady={false}
          workersReady={false}
          settingsLoading
        />
      </FormProvider>
    );
  }

  const view = render(<Fields />);

  const workspace = view.container.querySelector<HTMLButtonElement>(
    "#workspace-strategy",
  );

  assert.ok(workspace?.disabled);
  assert.equal(workspace?.getAttribute("aria-busy"), "true");
  assert.match(workspace?.textContent ?? "", /Loading…/);

  for (const name of ["Cost limit", "Runtime limit"]) {
    const control = view.getByRole("switch", { name });

    assert.equal(control.getAttribute("aria-disabled"), "true");
    assert.equal(control.getAttribute("aria-busy"), "true");
  }

  assert.match(view.container.textContent ?? "", /Loading budget options/);

  assert.doesNotMatch(
    view.container.textContent ?? "",
    /This provider requires No cost limit/,
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

  const view = render(<Fields />),
    costMode = view.getByRole("switch", { name: "Cost limit" }),
    cost = view.container.querySelector<HTMLInputElement>("#cost");

  assert.equal(costMode.getAttribute("aria-disabled"), "true");
  assert.equal(costMode.getAttribute("aria-busy"), null);
  assert.equal(costMode.getAttribute("aria-checked"), "true");
  assert.equal(cost?.disabled, true);
});
