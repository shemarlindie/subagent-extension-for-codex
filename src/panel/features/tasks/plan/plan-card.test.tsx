// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { onTestFinished, test } from "vitest";

import type { TaskPlan } from "../../../../shared/tasks/plan";
import type { PlanStep } from "../../../../shared/tasks/plan-contract";
import { Controller } from "../../../app/state/controller";
import { ControllerContext } from "../../../app/state/controller-context";
import { task } from "../../../app/state/controller-test-harness";
import type { Task, Transport } from "../../../app/state/types";
import { PlanCard } from "./plan-card";

const steps = (...statuses: PlanStep["status"][]): PlanStep[] =>
  statuses.map((status, i) => ({ content: `Step ${i + 1}`, status }));

const plan = (s: PlanStep[], stale?: true): TaskPlan => ({
  steps: s,
  turn: 1,
  updated_at: "2026-11-21T00:00:00.000Z",
  ...(stale ? { stale } : {}),
});

function setup() {
  onTestFinished(cleanup);

  const controller = new Controller(
    { embedded: true, dispose() {} } as unknown as Transport,
    { hidden: () => false, wide: () => false },
  );

  onTestFinished(() => controller.dispose());

  const card = (row: Task) => (
    <ControllerContext.Provider value={controller}>
      <PlanCard task={row} />
    </ControllerContext.Provider>
  );

  return { card };
}

const running = (p?: TaskPlan, id = "a"): Task => ({
  ...task(id),
  status: "running",
  ...(p ? { plan: p } : {}),
});

const visibleSteps = () =>
  screen
    .queryAllByRole("listitem")
    .map((step) => [
      step.querySelector("svg")?.getAttribute("aria-label"),
      step.querySelector(".plan-step-text")?.textContent,
    ]);

test("an open plan shows every step, and collapsing leaves the current one", async () => {
  const { card } = setup();

  const view = render(
    card(running(plan(steps("completed", "in_progress", "pending")))),
  );

  assert.ok(screen.getByRole("region", { name: "Plan, 1 of 3 steps done" }));

  assert.deepEqual(visibleSteps(), [
    ["Done", "Step 1"],
    ["In progress", "Step 2"],
    ["Pending", "Step 3"],
  ]);

  // The current step turns while the task runs.
  assert.ok(view.container.querySelector(".plan-step-spin"));

  await userEvent.click(
    screen.getByRole("button", { name: "Collapse plan, 1 of 3 steps done" }),
  );

  assert.deepEqual(visibleSteps(), []);
  const row = screen.getByRole("button", { expanded: false });
  assert.equal(row.querySelector(".plan-card-current")?.textContent, "Step 2");
  assert.equal(row.querySelector(".plan-card-count")?.textContent, "1 of 3");
});

test("collapsing stays with its task across remounts until the plan changes", async () => {
  const { card } = setup();
  const open = running(plan(steps("in_progress", "pending")));
  const view = render(card(open));
  await userEvent.click(screen.getByRole("button", { name: /Collapse plan/ }));

  // Another task's plan is unaffected, and the first stays collapsed on return.
  view.rerender(card(running(plan(steps("in_progress", "pending")), "b")));
  assert.equal(visibleSteps().length, 2);
  view.unmount();
  const again = render(card(open));
  assert.equal(visibleSteps().length, 0);

  // A new list opens expanded.
  again.rerender(
    card(running(plan(steps("in_progress", "pending", "pending")))),
  );

  assert.equal(visibleSteps().length, 3);
});

test("a stale plan says so and pauses its current step", () => {
  const { card } = setup();
  render(card(running(plan(steps("completed", "in_progress"), true))));

  assert.ok(screen.getByText("Plan from before your last message"));

  assert.deepEqual(visibleSteps()[1], [
    "Waiting for the worker to update the plan",
    "Step 2",
  ]);
});

test("a finished plan collapses to one line, and an empty one shows nothing", () => {
  const { card } = setup();

  const done = {
    ...running(plan(steps("completed", "completed"))),
    status: "completed" as const,
  };

  const view = render(card(done));

  const row = screen.getByRole("button", { expanded: false });

  assert.equal(
    row.querySelector(".plan-card-current")?.textContent,
    "All 2 steps done",
  );

  assert.equal(row.querySelector(".plan-card-count"), null);

  view.rerender(card(running(plan([]))));
  assert.equal(view.container.innerHTML, "");
});
