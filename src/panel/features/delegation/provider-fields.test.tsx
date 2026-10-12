// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { expect, test } from "vitest";

import type { Worker } from "../providers/types";
import {
  ApprovalField,
  BudgetFields,
  type DelegateValues,
  WorkerFields,
  WorkspaceField,
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

  assert.equal(
    view.container.querySelectorAll(".select-loading-spinner").length,
    2,
  );

  assert.doesNotMatch(view.container.textContent ?? "", /Inherit|Parent agent/);
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

test("a worker whose runtime isn't ready says why under the worker select", (t) => {
  t.onTestFinished(cleanup);
  const message = "Claude Code was not found on the service's PATH.";

  function Fields() {
    const form = useForm<DelegateValues>({
      defaultValues: { worker: "claude:reviewer", revision: "HEAD" },
    });

    return (
      <FormProvider {...form}>
        <WorkerFields
          workers={[
            {
              provider: "claude",
              profiles: ["reviewer"],
              capabilities: {},
              readiness: { ready: false, message, details: {} },
            },
          ]}
        />
      </FormProvider>
    );
  }

  const view = render(<Fields />);
  assert.equal(view.getByRole("alert").textContent, message);
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

  assert.equal(
    view.container.querySelectorAll(".select-loading-spinner").length,
    1,
  );

  assert.equal(
    view.container.querySelectorAll(".form-switch-spinner").length,
    2,
  );

  assert.equal(
    view.container.querySelectorAll(".async-control-spinner").length,
    2,
  );

  assert.match(view.container.textContent ?? "", /Loading budget options/);

  assert.doesNotMatch(
    view.container.textContent ?? "",
    /This provider requires No cost limit/,
  );
});

test("known budget selections stay visible without a spinner while workers finish loading", (t) => {
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
  assert.equal(view.container.querySelector(".select-loading-spinner"), null);
  assert.equal(view.container.querySelector(".async-control-spinner"), null);
});
