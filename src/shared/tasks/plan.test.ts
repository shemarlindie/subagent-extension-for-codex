import assert from "node:assert/strict";

import { test } from "vitest";

import type { PlanStep } from "./plan-contract.js";
import {
  applyPlanUpdate,
  markPlanStale,
  planResultLine,
  type TaskPlan,
} from "./plan.js";

const steps = (...statuses: PlanStep["status"][]): PlanStep[] =>
  statuses.map((status, i) => ({ content: `Step ${i + 1}`, status }));

test("items replace the plan and list changed steps only when the contents match", () => {
  const current = steps("in_progress", "pending");

  assert.deepEqual(applyPlanUpdate(undefined, { items: current }), {
    kind: "updated",
    steps: current,
  });

  assert.deepEqual(
    applyPlanUpdate(current, { items: steps("completed", "in_progress") }),
    {
      kind: "updated",
      steps: steps("completed", "in_progress"),
      changed: [0, 1],
    },
  );

  const revised = [...steps("completed", "in_progress", "pending")];

  assert.deepEqual(applyPlanUpdate(current, { items: revised }), {
    kind: "updated",
    steps: revised,
  });

  // The same list again reads as a whole list.
  assert.deepEqual(applyPlanUpdate(current, { items: current }), {
    kind: "updated",
    steps: current,
  });

  assert.deepEqual(applyPlanUpdate(current, { items: [] }), {
    kind: "updated",
    steps: [],
  });
});

test("advance completes the step in progress and starts the next pending one", () => {
  assert.deepEqual(
    applyPlanUpdate(steps("completed", "in_progress", "pending"), {
      advance: true,
    }),
    {
      kind: "updated",
      steps: steps("completed", "completed", "in_progress"),
      changed: [1, 2],
    },
  );

  // With no step in progress it starts the next pending one.
  assert.deepEqual(
    applyPlanUpdate(steps("pending", "pending"), { advance: true }),
    {
      kind: "updated",
      steps: steps("in_progress", "pending"),
      changed: [0],
    },
  );

  assert.deepEqual(applyPlanUpdate(steps("completed"), { advance: true }), {
    kind: "unchanged",
    message: "Plan unchanged: the only step is done.",
  });
});

test("invalid updates change nothing and say why", () => {
  const error = (current: PlanStep[] | undefined, input: object) => {
    const result = applyPlanUpdate(current, input);
    assert.equal(result.kind, "invalid");

    return result.error;
  };

  assert.equal(error(undefined, {}), "Send either items or advance: true.");

  assert.equal(
    error(undefined, { items: [], advance: true }),
    "Send either items or advance: true.",
  );

  assert.equal(
    error(undefined, { advance: true }),
    "There is no plan to advance.",
  );

  assert.equal(
    error(undefined, { items: steps(...Array(31).fill("pending")) }),
    "A plan has at most 30 steps.",
  );

  for (const content of [" ", "x".repeat(201)]) {
    assert.equal(
      error(undefined, { items: [{ content, status: "pending" }] }),
      "Each step needs text of 1 to 200 characters.",
    );
  }

  assert.equal(
    error(undefined, { items: steps("in_progress", "in_progress") }),
    "At most one step can be in progress.",
  );
});

test("the result line says where the plan stands", () => {
  assert.equal(
    planResultLine(steps("completed", "completed", "in_progress", "pending")),
    "Plan updated: step 3 of 4 is in progress.",
  );

  assert.equal(
    planResultLine(steps("completed", "completed")),
    "Plan updated: all 2 steps are done.",
  );

  assert.equal(planResultLine([]), "Plan cleared.");
});

test("only a plan with steps left goes stale", () => {
  const plan = (s: PlanStep[]): TaskPlan => ({
    steps: s,
    turn: 1,
    updated_at: "2026-11-21T00:00:00.000Z",
  });

  const open = plan(steps("completed", "in_progress"));
  markPlanStale(open);
  assert.equal(open.stale, true);

  const finished = plan(steps("completed"));
  markPlanStale(finished);
  assert.equal(finished.stale, undefined);
});
