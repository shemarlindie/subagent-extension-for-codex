// @vitest-environment jsdom
import assert from "node:assert/strict";

import { act, cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { expect, test, vi } from "vitest";

import { startSchema } from "../../../../core/shared/tasks/model.js";
import type { Controller } from "../../../app/state/controller";
import { ControllerContext } from "../../../app/state/controller-context";
import type { Task } from "../../../app/state/types";
import { TaskRow } from "../list/task-row";
import { TaskDetails } from "./task-details";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  writable: true,
  value: true,
});

const task = (patch: Partial<Task>): Task => ({
  ...startSchema.parse({
    repository: "/repo",
    title: "t",
    description: "t",
    worker_profile: "reviewer",
  }),
  id: "t",
  title: "t",
  owner: "o",
  repository: "/repo",
  status: "running",
  created_at: "",
  updated_at: "",
  created_by: "user",
  instructions_sent: 0,
  pending_steers: [],
  queue: [],
  turn: 1,
  runtime_ms: 60_000,
  ...patch,
});

const runtime = (view: ReturnType<typeof render>) =>
  [...view.container.querySelectorAll(".fact")]
    .find((fact) => fact.querySelector("dt")?.textContent === "Runtime used")
    ?.querySelector("dd")?.textContent;

test("a running task's runtime ticks and a finished task's stays fixed", (t) => {
  t.onTestFinished(() => {
    cleanup();
    vi.useRealTimers();
  });

  vi.useFakeTimers({ now: Date.parse("2026-10-02T12:00:30.000Z") });
  const running = task({ run_started_at: "2026-10-02T12:00:00.000Z" });
  const view = render(createElement(TaskDetails, { task: running }));
  assert.equal(runtime(view), "1m 30s");
  act(() => void vi.advanceTimersByTime(5000));
  assert.equal(runtime(view), "1m 35s");

  view.rerender(
    createElement(TaskDetails, {
      task: { ...running, status: "completed", runtime_ms: 95_000 },
    }),
  );

  act(() => void vi.advanceTimersByTime(5000));
  assert.equal(runtime(view), "1m 35s");
});

// The row only calls the controller from its menu, which these tests leave closed.
const row = (task: Task) =>
  createElement(
    ControllerContext.Provider,
    { value: {} as Controller },
    createElement(TaskRow, { task, current: false }),
  );

test("task list icons describe the running task's latest activity", (t) => {
  t.onTestFinished(cleanup);
  const view = render(row(task({})));

  const paused = {
    text: "Waiting for rate limit reset",
    state: "info",
  } as const;

  view.rerender(row(task({ live_activity: paused })));
  const icon = view.getByRole("img", { name: paused.text });
  assert.ok(icon.classList.contains("paused"));
  assert.equal(icon.dataset.tone, "attention");
  assert.equal(icon.getAttribute("title"), paused.text);

  // A failure shows no dot. Screen readers hear its short label.
  const failed = {
    text: "Context compaction failed",
    state: "failed",
  } as const;

  view.rerender(row(task({ live_activity: failed })));
  expect(view.queryByRole("img")).toBeNull();
  view.getByText("Compaction failed");
});

test("terminal states and input requests take precedence over stale activity", (t) => {
  t.onTestFinished(cleanup);

  const live_activity = {
    text: "Context compaction failed",
    state: "failed" as const,
  };

  const view = render(row(task({ live_activity })));

  // Finished rows show no dot, so only screen readers hear their status.
  for (const [status, label] of [
    ["completed", "Completed"],
    ["failed", "Failed"],
  ] as const) {
    view.rerender(row(task({ status, live_activity })));
    view.getByText(label);
    expect(view.queryByRole("img")).toBeNull();
  }

  view.rerender(
    row(
      task({
        status: "waiting",
        pending_input: {
          id: "question",
          kind: "question",
          tool: "AskUserQuestion",
          input: {},
        },
        live_activity,
      }),
    ),
  );

  assert.ok(
    view.getByRole("img", { name: "Needs input" }).classList.contains("input"),
  );

  expect(view.queryByRole("img", { name: live_activity.text })).toBeNull();
});
