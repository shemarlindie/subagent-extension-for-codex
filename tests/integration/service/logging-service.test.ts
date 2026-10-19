import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, test } from "vitest";

import { freePort, serviceEnv } from "../../support/service.js";

type LogRecord = Record<string, unknown>;

const token = "isolated-logging-service-test-credential";
const wrongToken = "isolated-logging-service-wrong-credential";
const sendRequestId = "0123456789abcdef0123456789abcdef";
const taskId = "task_01234567-89ab-cdef-0123-456789abcdef";

const readRecords = async (path: string): Promise<LogRecord[]> =>
  (await readFile(path, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as LogRecord);

test("isolated built service flushes correlated requests, auth failures, timing and lifecycle on shutdown", async (t) => {
  const data = await mkdtemp(join(tmpdir(), "logging-service-"));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;

  const child = spawn(process.execPath, [resolve("dist/main.js")], {
    env: serviceEnv(
      { data, port },
      {
        CODEX_SUBAGENT_EXTENSION_TOKEN: token,
        CODEX_SUBAGENT_EXTENSION_LOG_LEVEL: "debug",
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

  const request = (
    credential?: string,
    path = "/api/tools/list_projects",
    body: unknown = {},
  ) =>
    fetch(`${origin}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Codex-Subagent-Extension": "1",
        ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });

  const missing = await request();
  expect(missing.status).toBe(401);
  await missing.text();
  const wrong = await request(wrongToken);
  expect(wrong.status).toBe(401);
  await wrong.text();
  const success = await request(token);
  expect(success.status).toBe(200);
  await success.text();
  const requestId = success.headers.get("x-request-id");
  expect(requestId).toEqual(expect.any(String));

  // A panel timing batch, as the embedded panel uploads it.
  const upload = await request(token, "/api/user-tools/app_record_timing", {
    records: [
      {
        operation: "app_send_message",
        duration_ms: 42,
        task_id: taskId,
        request_id: sendRequestId,
        outcome: "success",
        ui_timed_out: false,
      },
    ],
  });

  expect(upload.status).toBe(200);
  await upload.text();
  const uploadId = upload.headers.get("x-request-id");
  expect(uploadId).toEqual(expect.any(String));

  child.kill("SIGTERM");
  expect(await exited).toBe(0);

  const text = await readFile(join(data, "service.jsonl"), "utf8");
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

  for (const [response, reason] of [
    [missing, "missing_credentials"],
    [wrong, "invalid_bearer"],
  ] as const) {
    expect(records).toContainEqual(
      expect.objectContaining({
        event: "auth.rejected",
        reason,
        request_id: response.headers.get("x-request-id"),
      }),
    );
  }

  expect(records).toContainEqual(
    expect.objectContaining({
      event: "http.request",
      request_id: requestId,
      method: "POST",
      route: "/api/tools/:name",
      status: 200,
      aborted: false,
    }),
  );

  expect(records).toContainEqual(
    expect.objectContaining({
      event: "tool.completed",
      request_id: requestId,
      tool: "list_projects",
      outcome: "success",
    }),
  );

  expect(text).not.toContain(token);
  expect(text).not.toContain(wrongToken);

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
      duration_ms: 42,
      task_id: taskId,
      send_ref: createHash("sha256")
        .update(sendRequestId)
        .digest("hex")
        .slice(0, 16),
      outcome: "success",
      ui_timed_out: false,
    }),
  );

  for (const record of timing) {
    expect(record.instance_id).toBe(instanceId);
  }

  // Neither the raw send ID nor the upload's own HTTP request ID is stored.
  expect(timingText).not.toContain(sendRequestId);
  expect(timingText).not.toContain(String(uploadId));
  expect(timingText).not.toContain(token);
});
