import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "vitest";

import { startSchema, type Task } from "../../../../shared/tasks/model.js";
import {
  configureLogging,
  flushLogs,
  logEvent,
  withLogContext,
} from "../../../platform/logging/logger.js";
import { observeExecution } from "./execution-logging.js";

test("task execution owns its context and restores the originating request context afterward", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "execution-logging-"));
  const path = join(directory, "events.jsonl");
  configureLogging(path);

  t.onTestFinished(async () => {
    await flushLogs();
    configureLogging(undefined);
    await rm(directory, { recursive: true, force: true });
  });

  const task: Task = {
    ...startSchema.parse({ repository: "/repo", description: "Review" }),
    id: "task-isolated",
    title: "Review",
    owner: "local",
    status: "running",
    created_at: "now",
    updated_at: "now",
    created_by: "user",
    instructions: [],
    instructions_sent: 0,
    pending_steers: [],
    queue: [],
    turn: 1,
    runtime_ms: 0,
    cost_usd: 0.1,
  };

  const parent = {
    request_id: "request-parent",
    route: "/api/tools/:name",
    tool: "send_message",
  };

  await withLogContext(parent, async () => {
    await observeExecution(task, async () => {
      await Promise.resolve();
      logEvent("info", "provider.result", { input_tokens: 10 });
      task.status = "completed";
      task.cost_usd = 0.3;
    });

    logEvent("info", "request.after_execution");
  });

  await flushLogs();

  const records: Record<string, unknown>[] = (await readFile(path, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

  expect(records.map((record) => record.event)).toEqual([
    "task.execution_started",
    "provider.result",
    "task.execution_completed",
    "request.after_execution",
  ]);

  for (const record of records.slice(0, 3)) {
    expect(record).toMatchObject({
      task_id: task.id,
      provider: task.provider,
      workspace_strategy: task.workspace_strategy,
    });

    expect(record).not.toHaveProperty("request_id");
    expect(record).not.toHaveProperty("route");
    expect(record).not.toHaveProperty("tool");
  }

  expect(records[2]).toMatchObject({
    status: "completed",
    duration_ms: expect.any(Number),
  });

  expect(records[2]?.cost_usd).toBeCloseTo(0.2);
  expect(records[3]).toMatchObject(parent);
  expect(records[3]).not.toHaveProperty("task_id");
});
