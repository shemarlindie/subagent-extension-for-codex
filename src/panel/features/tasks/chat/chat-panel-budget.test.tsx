// @vitest-environment jsdom
import assert from "node:assert/strict";

import { fireEvent, waitFor } from "@testing-library/react";
import { expect, test } from "vitest";

import { base, sent, setup } from "./chat-panel-test-harness";

test("runtime limits above 120 minutes preserve an existing composer draft", async () => {
  const { tool, view, composer, type, updateTask } = setup({
    status: "failed",
    error: "Runtime budget exhausted",
    budget: { ...base.budget, max_cost_usd: null },
    runtime_ms: 22 * 60_000,
    cost_usd: 0.44,
  });

  expect(view.getByText("Runtime limit reached")).toBeTruthy();
  expect(view.getByText("22 of 20 mins used")).toBeTruthy();

  const apply = view.getByRole("button", { name: "Apply" });

  type("Keep this draft");

  const limit = view.getByRole("spinbutton", {
    name: "Runtime limit (minutes)",
  });

  assert.equal(limit.getAttribute("max"), null);
  assert.equal((limit as HTMLInputElement).value, "20");

  assert.equal((apply as HTMLButtonElement).disabled, true);
  const limitSwitch = view.getByRole("switch", { name: "Runtime limit" });
  fireEvent.click(limitSwitch);
  assert.equal((limit as HTMLInputElement).disabled, true);
  assert.equal((apply as HTMLButtonElement).disabled, false);

  fireEvent.click(limitSwitch);
  assert.equal((limit as HTMLInputElement).disabled, false);
  assert.equal((apply as HTMLButtonElement).disabled, true);

  fireEvent.change(limit, { target: { value: "121" } });

  expect(view.queryByRole("alert")).toBeNull();

  assert.equal((apply as HTMLButtonElement).disabled, false);
  fireEvent.click(apply);

  await waitFor(() =>
    expect(sent(tool)).toEqual([
      [
        "app_raise_budget",
        { task_id: "task-1", budget: { max_runtime_minutes: 121 } },
      ],
    ]),
  );

  updateTask({
    budget: { ...base.budget, max_runtime_minutes: 121, max_cost_usd: null },
    budget_raised_for_turn: { turn: 1, runtime: true },
  });

  await waitFor(() => {
    assert.equal((composer as HTMLTextAreaElement).value, "Keep this draft");
    assert.equal(document.activeElement, composer);

    expect(view.getByRole("tooltip").textContent).toBe(
      "Press ENTER to continue",
    );
  });
});

test("combined budget notice prompts after both spent dimensions are raised", async () => {
  const { tool, view, composer, updateTask } = setup({
    status: "failed",
    error: "Cost and runtime budget exhausted",
    cost_usd: 5.02,
    runtime_ms: 22 * 60_000,
  });

  expect(
    view.getByText("Apply higher cost and runtime limits to continue."),
  ).toBeTruthy();

  const cost = view.getByRole("spinbutton", { name: "Cost limit" });
  fireEvent.change(cost, { target: { value: "8" } });

  fireEvent.click(
    view
      .getByRole("group", { name: "Raise cost limit" })
      .querySelector(".chat-budget-apply")!,
  );

  await waitFor(() => assert.equal(sent(tool).length, 1));

  updateTask({
    budget: { ...base.budget, max_cost_usd: 8 },
    budget_raised_for_turn: { turn: 1, cost: true },
  });

  assert.equal((composer as HTMLTextAreaElement).value, "");
  expect(view.queryByRole("tooltip")).toBeNull();
  expect(view.getByText("Runtime limit reached")).toBeTruthy();

  const runtime = view.getByRole("spinbutton", {
    name: "Runtime limit (minutes)",
  });

  fireEvent.change(runtime, { target: { value: "24" } });

  fireEvent.click(
    view
      .getByRole("group", { name: "Raise runtime limit" })
      .querySelector(".chat-budget-apply")!,
  );

  await waitFor(() => assert.equal(sent(tool).length, 2));

  updateTask({
    budget: { ...base.budget, max_cost_usd: 8, max_runtime_minutes: 24 },
    budget_raised_for_turn: { turn: 1, cost: true, runtime: true },
  });

  await waitFor(() => {
    assert.equal((composer as HTMLTextAreaElement).value, "Continue");
    assert.equal(document.activeElement, composer);

    expect(view.getByRole("tooltip").textContent).toBe(
      "Press ENTER to continue",
    );
  });
});

test("a runtime limit below the current budget shows validation feedback", () => {
  const { view } = setup({
    status: "failed",
    error: "Runtime budget exhausted",
    budget: { ...base.budget, max_cost_usd: null },
    runtime_ms: 22 * 60_000,
    cost_usd: 0.44,
  });

  const apply = view.getByRole("button", { name: "Apply" });

  const limit = view.getByRole("spinbutton", {
    name: "Runtime limit (minutes)",
  });

  fireEvent.change(limit, { target: { value: "19" } });

  assert.equal(
    view.getByRole("alert").textContent,
    "Enter a limit higher than 20 mins.",
  );

  assert.equal(limit.getAttribute("aria-invalid"), "true");
  assert.equal((apply as HTMLButtonElement).disabled, true);

  fireEvent.change(limit, { target: { value: "21" } });
  expect(view.queryByRole("alert")).toBeNull();
});

test("budget controls lock while a limit update is in flight", async () => {
  const { tool, view, composer, updateTask } = setup({
    status: "failed",
    error: "Claude result: error_max_budget_usd",
    cost_usd: 5.02,
  });

  let finishUpdate!: (value: unknown) => void;

  tool.mockImplementationOnce(
    () => new Promise((resolve) => (finishUpdate = resolve)),
  );

  const limit = view.getByRole("spinbutton", { name: "Cost limit" });
  const limitSwitch = view.getByRole("switch", { name: "Cost limit" });

  fireEvent.change(limit, { target: { value: "8" } });
  fireEvent.click(view.getByRole("button", { name: "Apply" }));

  expect((limit as HTMLInputElement).disabled).toBe(true);
  expect(limitSwitch.hasAttribute("data-disabled")).toBe(true);
  assert.equal((composer as HTMLTextAreaElement).value, "");
  expect(view.queryByRole("tooltip")).toBeNull();

  finishUpdate({});

  updateTask({
    budget: { ...base.budget, max_cost_usd: 8 },
    budget_raised_for_turn: { turn: 1, cost: true },
  });

  await waitFor(() => {
    expect(view.queryByRole("spinbutton", { name: "Cost limit" })).toBeNull();
    expect(view.queryByRole("switch", { name: "Cost limit" })).toBeNull();
    assert.equal((composer as HTMLTextAreaElement).value, "Continue");
    assert.equal(document.activeElement, composer);

    expect(view.getByRole("tooltip").textContent).toBe(
      "Press ENTER to continue",
    );
  });
});

test("a failed limit update does not prompt to continue", async () => {
  const { tool, view, composer } = setup({
    status: "failed",
    error: "Claude result: error_max_budget_usd",
    cost_usd: 5.02,
  });

  tool.mockRejectedValueOnce(new Error("Could not update the limit"));

  fireEvent.change(view.getByRole("spinbutton", { name: "Cost limit" }), {
    target: { value: "8" },
  });

  fireEvent.click(view.getByRole("button", { name: "Apply" }));

  await waitFor(() =>
    expect(view.getByRole("alert").textContent).toBe(
      "Could not update the limit",
    ),
  );

  assert.equal((composer as HTMLTextAreaElement).value, "");
  expect(view.queryByRole("tooltip")).toBeNull();
});

test("a successful limit update opens and focuses a collapsed composer", async () => {
  const { tool, view, updateTask } = setup({
    status: "failed",
    error: "Claude result: error_max_budget_usd",
    cost_usd: 5.02,
  });

  fireEvent.click(view.getByRole("button", { name: "Hide composer" }));
  expect(view.queryByRole("textbox", { name: "Message" })).toBeNull();

  fireEvent.change(view.getByRole("spinbutton", { name: "Cost limit" }), {
    target: { value: "8" },
  });

  fireEvent.click(view.getByRole("button", { name: "Apply" }));

  await waitFor(() => assert.equal(sent(tool).length, 1));

  updateTask({
    budget: { ...base.budget, max_cost_usd: 8 },
    budget_raised_for_turn: { turn: 1, cost: true },
  });

  await waitFor(() => {
    const composer = view.getByRole("textbox", { name: "Message" });
    assert.equal((composer as HTMLTextAreaElement).value, "Continue");
    assert.equal(document.activeElement, composer);

    expect(view.getByRole("tooltip").textContent).toBe(
      "Press ENTER to continue",
    );
  });
});
