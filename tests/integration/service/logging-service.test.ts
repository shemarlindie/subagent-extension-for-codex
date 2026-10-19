import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, test } from "vitest";

import { freePort, serviceEnv } from "../../support/service.js";

type LogRecord = Record<string, unknown>;

const token = "isolated-logging-service-test-credential";
const wrongToken = "isolated-logging-service-wrong-credential";

test("isolated built service flushes correlated requests, auth failures and lifecycle on shutdown", async (t) => {
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

  const request = (credential?: string) =>
    fetch(`${origin}/api/tools/list_projects`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Codex-Subagent-Extension": "1",
        ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
      },
      body: "{}",
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

  child.kill("SIGTERM");
  expect(await exited).toBe(0);

  const text = await readFile(join(data, "service.jsonl"), "utf8");

  const records: LogRecord[] = text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

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
});
