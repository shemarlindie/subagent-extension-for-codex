// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { onTestFinished, test } from "vitest";

import type { ChatPlan } from "../../../../shared/tasks/conversation/chat";
import type { TaskPlan } from "../../../../shared/tasks/plan";
import type { PlanStep } from "../../../../shared/tasks/plan-contract";
import { Controller } from "../../../app/state/controller";
import { ControllerContext } from "../../../app/state/controller-context";
import type { Transport } from "../../../app/state/types";
import { PlanCard } from "./plan-card";
import { PlanHistoryRow } from "./plan-history-row";

const steps = (...statuses: PlanStep["status"][]): PlanStep[] =>
  statuses.map((status, i) => ({ content: `Step ${i + 1}`, status }));

const plan = (s: PlanStep[], stale?: true): TaskPlan => ({
  steps: s,
  ...(stale ? { stale } : {}),
});

function setup() {
  onTestFinished(cleanup);

  const controller = new Controller(
    { embedded: true, dispose() {} } as unknown as Transport,
    { hidden: () => false, wide: () => false },
  );

  onTestFinished(() => controller.dispose());

  const card = (
    p: TaskPlan,
    working = true,
    taskId = "a",
    onResize?: () => void,
  ) => (
    <ControllerContext.Provider value={controller}>
      <PlanCard
        taskId={taskId}
        plan={p}
        working={working}
        onResize={onResize}
      />
    </ControllerContext.Provider>
  );

  return { card };
}

const visibleSteps = () =>
  screen
    .queryAllByRole("listitem")
    .map((step) => [
      step.querySelector("svg")?.getAttribute("aria-label"),
      step.querySelector(".plan-step-text")?.textContent,
    ]);

test("an open plan shows every step, and collapsing leaves the current one", async () => {
  const { card } = setup();

  const view = render(card(plan(steps("completed", "in_progress", "pending"))));

  assert.ok(screen.getByRole("region", { name: "Plan, 1 of 3 steps done" }));

  assert.deepEqual(visibleSteps(), [
    ["Done", "Step 1"],
    ["In progress", "Step 2"],
    ["Pending", "Step 3"],
  ]);

  // The current step turns while the worker is on it, and pauses otherwise,
  // as during a compaction.
  assert.ok(view.container.querySelector(".plan-step-spin"));

  view.rerender(
    card(plan(steps("completed", "in_progress", "pending")), false),
  );

  assert.equal(view.container.querySelector(".plan-step-spin"), null);
  assert.deepEqual(visibleSteps()[1], ["Paused", "Step 2"]);

  const header = screen.getByRole("button", { expanded: true });
  assert.equal(header.textContent, "Plan1 of 3");
  await userEvent.click(header);

  assert.deepEqual(visibleSteps(), []);
  const row = screen.getByRole("button", { expanded: false });
  assert.equal(row.querySelector(".plan-card-current")?.textContent, "Step 2");
  assert.equal(row.querySelector(".plan-card-count")?.textContent, "1 of 3");
});

test("collapsing stays with its task across remounts until the plan changes", async () => {
  const { card } = setup();
  const open = plan(steps("in_progress", "pending"));
  const view = render(card(open));
  await userEvent.click(screen.getByRole("button", { expanded: true }));

  // Another task's plan is unaffected, and the first stays collapsed on return.
  view.rerender(card(plan(steps("in_progress", "pending")), true, "b"));
  assert.equal(visibleSteps().length, 2);
  view.unmount();
  const again = render(card(open));
  assert.equal(visibleSteps().length, 0);

  // A new list opens expanded.
  again.rerender(card(plan(steps("in_progress", "pending", "pending"))));

  assert.equal(visibleSteps().length, 3);
});

test("the card reports each resize so Chat can keep its latest message in view", async () => {
  const { card } = setup();
  let resizes = 0;
  const onResize = () => resizes++;

  const view = render(
    card(plan(steps("in_progress", "pending")), true, "a", onResize),
  );

  assert.equal(resizes, 0);

  await userEvent.click(screen.getByRole("button", { expanded: true }));
  assert.equal(resizes, 1);

  // A stale plan only renames the header, so the card keeps its size.
  view.rerender(
    card(plan(steps("in_progress", "pending"), true), true, "a", onResize),
  );

  assert.equal(resizes, 1);

  view.rerender(
    card(plan(steps("in_progress", "pending", "pending")), true, "a", onResize),
  );

  assert.equal(resizes, 2);
});

test("a stale plan says so and pauses its current step", () => {
  const { card } = setup();
  render(card(plan(steps("completed", "in_progress"), true)));

  assert.equal(
    screen.getByRole("button", { expanded: true }).textContent,
    "Plan from before your last message1 of 2",
  );

  assert.deepEqual(visibleSteps()[1], [
    "Waiting for the worker to update the plan",
    "Step 2",
  ]);
});

test("an ended plan folds into one Chat row that expands to its steps", async () => {
  onTestFinished(cleanup);

  const item: ChatPlan = {
    kind: "plan",
    id: "e1",
    event_id: 1,
    timestamp: "",
    steps: steps("completed", "pending"),
  };

  render(<PlanHistoryRow item={item} />);
  const row = screen.getByRole("button", { expanded: false });

  assert.equal(
    row.querySelector(".plan-card-current")?.textContent,
    "Plan · 1 of 2 steps done",
  );

  assert.deepEqual(visibleSteps(), []);
  await userEvent.click(row);

  assert.deepEqual(visibleSteps(), [
    ["Done", "Step 1"],
    ["Pending", "Step 2"],
  ]);
});
