import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test, vi } from "vitest";

import {
  configureLogging,
  flushLogs,
} from "../../../src/service/platform/logging/logger.js";
import { httpFixture } from "./http-test-harness.js";

interface RejectedAttempt {
  path: string;
  body: Record<string, string>;
  headers: Record<string, string>;
  reason: string;
  status: number;
}

async function loggingFixture(t: import("vitest").TestContext) {
  const fixture = await httpFixture(t);
  const logPath = join(fixture.dir, "service.jsonl");
  configureLogging(logPath);

  t.onTestFinished(async () => {
    await flushLogs();
    configureLogging(undefined);
  });

  const records = async (): Promise<Record<string, unknown>[]> => {
    await flushLogs();

    const text = await readFile(logPath, "utf8").catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return "";
        throw error;
      },
    );

    return text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  };

  return { ...fixture, records, logPath };
}

test("records console and MCP authentication rejection reasons without credentials", async (t) => {
  const { post, records, logPath } = await loggingFixture(t);

  const attempts: RejectedAttempt[] = [
    {
      path: "/api/login",
      body: {},
      headers: {},
      reason: "missing_token",
      status: 401,
    },
    {
      path: "/api/login",
      body: { token: "wrong-console-secret" },
      headers: {},
      reason: "invalid_token",
      status: 401,
    },
    {
      path: "/mcp",
      body: {},
      headers: {},
      reason: "missing_credentials",
      status: 401,
    },
    {
      path: "/mcp",
      body: {},
      headers: { Authorization: "Bearer wrong-mcp-secret" },
      reason: "invalid_bearer",
      status: 401,
    },
    {
      path: "/api/tools/list_tasks",
      body: {},
      headers: { Authorization: "Bearer private-token" },
      reason: "csrf_header_missing",
      status: 403,
    },
    {
      path: "/api/login",
      body: { token: "private-token" },
      headers: { Origin: "https://denied-origin-secret.invalid" },
      reason: "origin_denied",
      status: 403,
    },
  ];

  for (const attempt of attempts) {
    const response = await post(attempt.path, attempt.body, attempt.headers);
    await response.text();
    expect(response.status).toBe(attempt.status);
    const requestId = response.headers.get("x-request-id");
    expect(requestId).toEqual(expect.any(String));

    expect(await records()).toContainEqual(
      expect.objectContaining({
        event: "auth.rejected",
        level: "warn",
        request_id: requestId,
        route:
          attempt.path === "/api/tools/list_tasks"
            ? "/api/tools/:name"
            : attempt.path,
        reason: attempt.reason,
      }),
    );
  }

  const login = await post("/api/login", { token: "private-token" });
  await login.text();
  const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 3_600_001);
  let expired: Response;

  try {
    expired = await post(
      "/api/tools/list_tasks",
      {},
      { Cookie: cookie, "X-Subagent-Extension-For-Codex": "1" },
    );

    await expired.text();
  } finally {
    clock.mockRestore();
  }

  expect(expired.status).toBe(401);

  expect(await records()).toContainEqual(
    expect.objectContaining({
      event: "auth.rejected",
      request_id: expired.headers.get("x-request-id"),
      reason: "invalid_or_expired_session",
    }),
  );

  const text = await readFile(logPath, "utf8");

  for (const secret of [
    "private-token",
    "wrong-console-secret",
    "wrong-mcp-secret",
    "denied-origin-secret",
    cookie,
  ]) {
    expect(text).not.toContain(secret);
  }
});

test("correlates HTTP and tool results while excluding request payloads and URL contents", async (t) => {
  const { post, records, logPath, base } = await loggingFixture(t);

  const response = await post(
    "/api/tools/get_task?token=query-secret",
    { task_id: "missing-body-secret" },
    {
      Authorization: "Bearer private-token",
      "X-Subagent-Extension-For-Codex": "1",
      "X-Request-Id": "untrusted-client-request-secret",
    },
  );

  await response.text();
  expect(response.status).toBe(400);
  const requestId = response.headers.get("x-request-id");
  expect(requestId).toEqual(expect.any(String));
  expect(requestId).not.toBe("untrusted-client-request-secret");

  const correlated = (await records()).filter(
    (record) => record.request_id === requestId,
  );

  expect(
    correlated.filter((record) => record.event === "tool.completed"),
  ).toHaveLength(1);

  expect(correlated).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        event: "tool.completed",
        tool: "get_task",
        level: "warn",
        outcome: "rejected",
        duration_ms: expect.any(Number),
      }),
      expect.objectContaining({
        event: "http.request",
        route: "/api/tools/:name",
        status: 400,
        aborted: false,
        duration_ms: expect.any(Number),
      }),
    ]),
  );

  const unknown = await fetch(
    `${base}/private-path-secret?token=other-query-secret`,
  );

  await unknown.text();
  expect(unknown.status).toBe(404);

  expect(await records()).toContainEqual(
    expect.objectContaining({
      event: "http.request",
      route: "unknown",
      status: 404,
    }),
  );

  const text = await readFile(logPath, "utf8");

  for (const secret of [
    "private-token",
    "query-secret",
    "missing-body-secret",
    "private-path-secret",
    "untrusted-client-request-secret",
  ]) {
    expect(text).not.toContain(secret);
  }
});
