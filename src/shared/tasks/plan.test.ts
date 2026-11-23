import assert from "node:assert/strict";

import { test } from "vitest";

import type { PlanStep } from "./plan-contract.js";
import { applyPlanUpdate } from "./plan.js";

const steps = (...statuses: PlanStep["status"][]): PlanStep[] =>
  statuses.map((status, i) => ({ content: `Step ${i + 1}`, status }));

test("items replace the plan and list changed steps only when the contents match", () => {
  const current = steps("in_progress", "pending");

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

test("done and start catch the plan up by step number", () => {
  // Past step 1, the worker completes 1 and 2 and starts 3.
  assert.deepEqual(
    applyPlanUpdate(steps("in_progress", "pending", "pending", "pending"), {
      done: [1, 2],
      start: 3,
    }),
    {
      kind: "updated",
      steps: steps("completed", "completed", "in_progress", "pending"),
      changed: [0, 1, 2],
    },
  );

  // Starting another step leaves an unfinished one pending.
  assert.deepEqual(
    applyPlanUpdate(steps("in_progress", "pending"), { start: 2 }),
    {
      kind: "updated",
      steps: steps("pending", "in_progress"),
      changed: [0, 1],
    },
  );

  // done alone starts nothing.
  assert.deepEqual(
    applyPlanUpdate(steps("in_progress", "pending"), { done: [1] }),
    { kind: "updated", steps: steps("completed", "pending"), changed: [0] },
  );

  assert.deepEqual(
    applyPlanUpdate(steps("completed", "pending"), { done: [1] }),
    {
      kind: "unchanged",
      message: "Plan unchanged: those steps already have that status.",
    },
  );
});

test("invalid updates change nothing and say why", () => {
  const error = (current: PlanStep[] | undefined, input: object) => {
    const result = applyPlanUpdate(current, input);
    assert.equal(result.kind, "invalid");

    return result.error;
  };

  const oneForm = "Send one of items, advance: true, or done and start.";
  assert.equal(error(steps("pending"), { advance: true, start: 1 }), oneForm);

  assert.equal(
    error(undefined, { done: [1] }),
    "There is no plan yet. Send items first.",
  );

  assert.equal(
    error(steps("pending", "pending"), { start: 3 }),
    "Step numbers run from 1 to 2.",
  );

  assert.equal(
    error(steps("pending", "pending"), { done: [1], start: 1 }),
    "A step can't be both done and started.",
  );

  assert.equal(
    error(undefined, { items: steps("in_progress", "in_progress") }),
    "At most one step can be in progress.",
  );
});
