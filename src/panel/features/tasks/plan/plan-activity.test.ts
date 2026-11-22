// @vitest-environment jsdom
import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import type { PlanStep } from "../../../../shared/tasks/plan-contract";
import { event, parseHtml } from "../activity/activity-ui-test-harness";
import { EventList } from "../activity/event-list";

const steps = (...statuses: PlanStep["status"][]): PlanStep[] =>
  statuses.map((status, i) => ({ content: `Step ${i + 1}`, status }));

test("Activity shows a new plan in full and an update with only its changed steps", () => {
  const html = parseHtml(
    renderToStaticMarkup(
      createElement(EventList, {
        events: [
          event(
            "agent.plan",
            { steps: steps("in_progress", "pending", "pending") },
            "new",
          ),
          event(
            "agent.plan",
            {
              steps: steps("completed", "in_progress", "pending"),
              changed: [0, 1],
            },
            "update",
          ),
        ],
      }),
    ),
  );

  const rows = [...html.querySelectorAll(".activity-group")].map((row) => ({
    title: row.querySelector(".activity-group-title strong")?.textContent,
    summary: row.querySelector(".activity-group-summary")?.textContent,
    steps: [...row.querySelectorAll(".plan-step")].map((step) => [
      step.querySelector("svg")?.getAttribute("aria-label"),
      step.querySelector(".plan-step-text")?.textContent,
    ]),
  }));

  assert.deepEqual(rows, [
    {
      title: "Plan",
      summary: "3 steps",
      steps: [
        ["In progress", "Step 1"],
        ["Pending", "Step 2"],
        ["Pending", "Step 3"],
      ],
    },
    {
      title: "Plan",
      summary: "1 of 3",
      steps: [
        ["Done", "Step 1"],
        ["In progress", "Step 2"],
      ],
    },
  ]);

  // Activity's icons hold still.
  assert.equal(html.querySelector(".plan-step-spin"), null);
});
