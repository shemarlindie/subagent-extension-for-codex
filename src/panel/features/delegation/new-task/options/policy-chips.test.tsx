// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { afterEach, test } from "vitest";

import type { ProviderPolicy } from "../../../../../shared/providers/types";
import { ChipSelect } from "../../../../shared/components/select/chip-select";
import type { DelegateValues } from "../../delegate-values";
import { ModelAutocomplete } from "../../fields/model-autocomplete";
import { startTaskArguments } from "../../start-task";
import { PermissionChip, permissionChipLabel } from "./permission-chip";

afterEach(cleanup);

const options = [
  { value: "default", label: "Default — ask for approval" },
  {
    value: "bypassPermissions",
    label: "Bypass permission prompts",
    disabled: true,
    description: "Turned off by your organization",
  },
];

const models = [{ value: "haiku", displayName: "Haiku", description: "" }];

const policy: ProviderPolicy = {
  managed: true,
  blocked: [
    {
      setting: "permission_mode",
      value: "bypassPermissions",
      reason: "Turned off by your organization",
    },
  ],
  available_models: ["haiku"],
  available_models_match: "prefix",
  notes: [],
};

function Form({
  values,
  children,
  submit,
}: {
  values: Partial<DelegateValues>;
  children: React.ReactNode;
  submit?: () => void;
}) {
  const form = useForm<DelegateValues>({ defaultValues: values });

  return (
    <FormProvider {...form}>
      <form
        aria-label="Task"
        onSubmit={(event) => void form.handleSubmit(() => submit?.())(event)}
      >
        {children}
      </form>
    </FormProvider>
  );
}

test("a locked mode shows its reason, and neither a click nor the keyboard picks it", async () => {
  render(
    <Form values={{ permission_mode: "default" }}>
      <PermissionChip
        options={options}
        readOnly={false}
        loading={false}
        disabled={false}
      />
    </Form>,
  );

  const chip = screen.getByRole("combobox", { name: /Permission mode/ });
  fireEvent.click(chip);

  const locked = await screen.findByRole("option", { name: /Bypass/ });
  assert.equal(locked.getAttribute("aria-disabled"), "true");
  assert.ok(locked.textContent?.includes("Turned off by your organization"));

  fireEvent.click(locked);
  fireEvent.keyDown(locked, { key: "Enter" });
  assert.match(chip.getAttribute("aria-label") ?? "", /: Ask$/);
});

test("a saved mode now blocked reads and submits as the fallback", () => {
  render(
    <Form values={{ permission_mode: "bypassPermissions" }}>
      <PermissionChip
        options={options}
        readOnly={false}
        loading={false}
        disabled={false}
      />
    </Form>,
  );

  assert.match(
    screen.getByRole("combobox").getAttribute("aria-label") ?? "",
    /: Ask$/,
  );

  assert.equal(
    permissionChipLabel(options, "bypassPermissions", false),
    "Ask for approval",
  );

  const input = startTaskArguments(
    {
      permission_mode: "bypassPermissions",
      approval_decider: "user",
      worker: "claude:implementer",
      model: "",
      context: "",
      deps: [],
      runtimeMode: "none",
      costMode: "none",
    } as unknown as DelegateValues,
    [{ provider: "claude", profiles: [], capabilities: {}, policy }],
    undefined,
  );

  assert.equal(input.provider_options?.claude?.permission_mode, "default");
});

test("a menu can explain a limited list", async () => {
  render(
    <ChipSelect
      id="model"
      label="Model"
      value=""
      onValueChange={() => {}}
      options={[{ value: "haiku", label: "Haiku" }]}
      footer="Your organization limits these models."
    />,
  );

  fireEvent.click(screen.getByRole("combobox", { name: /Model/ }));
  await screen.findByText("Your organization limits these models.");
});

test("a typed model outside the allowlist gets an inline error and can't submit", async () => {
  let submitted = 0;

  const typed = (limits?: ProviderPolicy) => (
    <Form values={{ model: "opus" }} submit={() => submitted++}>
      <ModelAutocomplete models={models} policy={limits} placeholder="Model" />
    </Form>
  );

  const view = render(typed(policy));
  fireEvent.submit(screen.getByRole("form"));
  await screen.findByText("Your organization doesn't allow this model.");
  assert.equal(submitted, 0);
  view.unmount();

  render(typed());
  fireEvent.submit(screen.getByRole("form"));
  await new Promise((resolve) => setTimeout(resolve));
  assert.equal(submitted, 1);
});
