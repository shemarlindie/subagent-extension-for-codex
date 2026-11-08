import { expect, test } from "vitest";

import { startSchema, type Task } from "../../../../shared/tasks/model.js";
import { Store } from "../storage/store.js";
import { queueSnapshot } from "./queue.js";
import { commitSend } from "./send-acceptance.js";

function fixture(t: { onTestFinished(fn: () => void): void }) {
  const store = new Store(":memory:");
  t.onTestFinished(() => store.close());
  const message = { id: "original", message: "Review", from: "user" as const };

  const task: Task = {
    ...startSchema.parse({ repository: "/repo", description: "Review" }),
    title: "Review",
    id: "send",
    owner: "alice",
    created_by: "user",
    status: "running",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    instructions_sent: 1,
    pending_steers: [message],
    queue: [{ ...message, delivery: "queue" }],
    queue_paused: true,
    error: "Previous failure",
    error_code: "cost_budget_exhausted",
    completed_at: "2026-01-01T00:01:00.000Z",
    turn: 1,
    runtime_ms: 0,
    budget: { max_runtime_minutes: 10, max_cost_usd: 1 },
    provider_options: { claude: { approval_decider: "user" } },
    pending_input: {
      id: "question",
      tool: "AskUserQuestion",
      kind: "question",
      input: { question: "Proceed?" },
    },
  };

  store.save(task);

  return { store, task };
}

test("failed send acceptance restores send fields and keeps active references", (t) => {
  const { store, task } = fixture(t);
  const before = structuredClone(task);
  const active = { task };
  const { provider_options, pending_input } = task;
  const steer = task.pending_steers[0];
  const queued = task.queue[0];
  const revision = store.revision(task.owner);
  const heard: string[] = [];
  store.bus.on("event", () => heard.push("event"));
  store.bus.on("change", () => heard.push("change"));

  expect(() =>
    commitSend(store, task, () => {
      task.pending_steers.length = 0;
      task.queue.splice(0, 1);
      task.budget.max_runtime_minutes = 20;
      task.budget.max_cost_usd = 2;
      task.status = "queued";
      delete task.queue_paused;
      delete task.error;
      delete task.error_code;
      delete task.completed_at;
      store.save(task);
      store.event(task, "task.queued");
      throw new Error("receipt write failed");
    }),
  ).toThrow("receipt write failed");

  expect(active.task).toBe(task);
  expect(task).toEqual(before);
  expect(task.provider_options).toBe(provider_options);
  expect(task.pending_input).toBe(pending_input);
  expect(task.pending_steers[0]).toBe(steer);
  expect(task.queue[0]).toBe(queued);
  expect(store.get(task.id, task.owner)).toEqual(before);
  expect(store.events(task.id, task.owner)).toEqual([]);
  expect(store.revision(task.owner)).toBe(revision);
  expect(heard).toEqual([]);
});

test("rollback restores optional send fields that were initially absent", (t) => {
  const { store, task } = fixture(t);
  delete task.queue_paused;
  delete task.error;
  delete task.error_code;
  delete task.completed_at;

  expect(() =>
    commitSend(store, task, () => {
      task.queue_paused = true;
      task.error = "Send failed";
      task.error_code = "cost_budget_exhausted";
      task.completed_at = "later";
      throw new Error("write failed");
    }),
  ).toThrow("write failed");

  expect(task.queue_paused).toBeUndefined();
  expect(task.error).toBeUndefined();
  expect(task.error_code).toBeUndefined();
  expect(task.completed_at).toBeUndefined();
});

test("successful send acceptance retains writes and publishes committed events", (t) => {
  const { store, task } = fixture(t);
  const heard: string[] = [];
  store.bus.on("event", () => heard.push("event"));

  commitSend(store, task, () => {
    task.queue.push({
      id: "new",
      message: "Continue",
      from: "user",
      delivery: "queue",
    });

    task.budget.max_cost_usd = 2;
    store.save(task);
    store.event(task, "task.queue_changed", queueSnapshot(task));
    expect(heard).toEqual([]);
  });

  expect(task.queue).toHaveLength(2);
  expect(task.budget.max_cost_usd).toBe(2);
  expect(store.get(task.id, task.owner)).toEqual(task);
  expect(store.events(task.id, task.owner)).toHaveLength(1);
  expect(heard).toEqual(["event"]);
});
