import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, test } from "vitest";

import { freePort, serviceEnv } from "../../support/service.js";

type LogRecord = Record<string, unknown>;

const token = "isolated-logging-service-test-credential";
const sendRequestId = "0123456789abcdef0123456789abcdef";
const taskId = "task_01234567-89ab-cdef-0123-456789abcdef";

const readRecords = async (path: string): Promise<LogRecord[]> =>
  (await readFile(path, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as LogRecord);

test("isolated built service flushes lifecycle and correlated timing on shutdown", async (t) => {
  const data = await mkdtemp(join(tmpdir(), "logging-service-"));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;

  const child = spawn(process.execPath, [resolve("dist/main.js")], {
    env: serviceEnv(
      { data, port },
      {
        SUBAGENT_EXTENSION_FOR_CODEX_TOKEN: token,
        SUBAGENT_EXTENSION_FOR_CODEX_LOG_LEVEL: "debug",
      },
    ),
    stdio: "ignore",
  });

  const exited = new Promise<number | null>((done) => {
    child.once("exit", done);
    child.once("error", () => done(-1));
  });

  t.onTestFinished(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }

    await exited;
    await rm(data, { recursive: true, force: true });
  });

  await expect
    .poll(
      async () => {
        try {
          const response = await fetch(`${origin}/health`, {
            signal: AbortSignal.timeout(1000),
          });

          return response.ok;
        } catch {
          return false;
        }
      },
      { timeout: 15000 },
    )
    .toBe(true);

  // A panel timing batch, as the embedded panel uploads it.
  const upload = await fetch(`${origin}/api/user-tools/app_record_timing`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Subagent-Extension-For-Codex": "1",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      records: [
        {
          operation: "app_send_message",
          duration_ms: 42,
          task_id: taskId,
          request_id: sendRequestId,
        },
      ],
    }),
    signal: AbortSignal.timeout(5000),
  });

  expect(upload.status).toBe(200);
  await upload.text();
  const uploadId = upload.headers.get("x-request-id");
  expect(uploadId).toEqual(expect.any(String));

  child.kill("SIGTERM");
  expect(await exited).toBe(0);

  const records = await readRecords(join(data, "service.jsonl"));

  const lifecycle = records
    .filter((record) =>
      [
        "service.starting",
        "service.ready",
        "service.stopping",
        "service.stopped",
      ].includes(String(record.event)),
    )
    .map((record) => record.event);

  expect(lifecycle).toEqual([
    "service.starting",
    "service.ready",
    "service.stopping",
    "service.stopped",
  ]);

  expect(records).toContainEqual(
    expect.objectContaining({
      event: "service.stopping",
      signal: "SIGTERM",
      parent_pid: process.pid,
      active_tasks: 0,
    }),
  );

  expect(JSON.stringify(records)).not.toContain(token);

  // Timing records join service records through the logger's instance ID.
  const [instanceId] = records
    .filter((record) => record.event === "service.ready")
    .map((record) => record.instance_id);

  expect(instanceId).toEqual(expect.any(String));
  const timingText = await readFile(join(data, "timing.jsonl"), "utf8");
  const timing = await readRecords(join(data, "timing.jsonl"));

  expect(timing).toContainEqual(
    expect.objectContaining({
      event: "task.timing",
      phase: "transport",
      instance_id: instanceId,
      operation: "app_send_message",
      task_id: taskId,
      send_ref: createHash("sha256")
        .update(sendRequestId)
        .digest("hex")
        .slice(0, 16),
    }),
  );

  // Neither the raw send ID nor the upload's own HTTP request ID is stored.
  expect(timingText).not.toContain(sendRequestId);
  expect(timingText).not.toContain(String(uploadId));
  expect(timingText).not.toContain(token);
});
