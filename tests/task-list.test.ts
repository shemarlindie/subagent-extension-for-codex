import assert from "node:assert/strict";
import { test } from "vitest";
import { listedTask, type ListedTask } from "../src/core/task-list.js";
import { previewTasks, previewEvents } from "../ui/transports/preview-fixtures";
import { previewTool } from "../ui/transports/preview-tools";
import type { Event } from "../src/core/model.js";

test("preview task listing exposes the latest rate limit and provider failure summaries", () => {
  const tasks = previewTool("list_agent_tasks", {
    conversation_id: null,
  }) as ListedTask[];
  for (const [title, expected] of [
    [
      "Live: waiting for a rate limit",
      { text: "Waiting for rate limit reset", state: "info" },
    ],
    [
      "Live: provider failure",
      { text: "Context compaction failed", state: "failed" },
    ],
  ] as const) {
    const task = tasks.find((task) => task.title === title);
    assert.ok(task);
    assert.deepEqual(task.live_activity, expected);
    const source = previewTasks.find((source) => source.id === task.id);
    assert.ok(source);
    assert.equal("live_activity" in source, false);
  }
  for (const task of tasks.filter((task) => task.status !== "running")) {
    assert.equal(task.live_activity, undefined);
  }
});

test("list summaries recover after subsequent work and disappear when the task stops", () => {
  for (const title of [
    "Live: waiting for a rate limit",
    "Live: provider failure",
  ]) {
    const task = previewTasks.find((task) => task.title === title);
    assert.ok(task);
    const events = previewEvents.filter((event) => event.task_id === task.id);
    const before = listedTask(task, events);
    assert.ok(before.live_activity);
    assert.notEqual(before.live_activity.state, "running");
    const continued: Event = {
      id: Math.max(...events.map((event) => event.id)) + 1,
      task_id: task.id,
      timestamp: task.updated_at,
      type: "task.continued",
      data: {},
    };
    assert.deepEqual(listedTask(task, [...events, continued]).live_activity, {
      text: "Working",
      state: "running",
    });
    for (const status of [
      "waiting",
      "interrupted",
      "completed",
      "failed",
      "cancelled",
    ] as const) {
      assert.equal(
        listedTask({ ...task, status }, events).live_activity,
        undefined,
      );
    }
    assert.equal("live_activity" in task, false);
  }
});
