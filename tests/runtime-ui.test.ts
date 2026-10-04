// @vitest-environment jsdom
import assert from "node:assert/strict";
import { test, vi } from "vitest";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  writable: true,
  value: true,
});
import { createElement } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { startSchema, type Task } from "../src/core/model.js";
import { TaskDetails } from "../ui/components/task-details";

const task = (patch: Partial<Task>): Task => ({
  ...startSchema.parse({
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
  instructions: [],
  attempt: 1,
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
