import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "vitest";

import {
  configureLogging,
  flushLogs,
  logError,
  logEvent,
  setLogSecrets,
  withLogContext,
} from "./logger.js";

async function logFile(t: import("vitest").TestContext, level = "info") {
  const directory = await mkdtemp(join(tmpdir(), "logging-events-"));
  const path = join(directory, "events.jsonl");
  configureLogging(path, level);

  t.onTestFinished(async () => {
    await flushLogs();
    configureLogging(undefined);
    await rm(directory, { recursive: true, force: true });
  });

  return path;
}

async function records(path: string): Promise<Record<string, unknown>[]> {
  await flushLogs();

  return (await readFile(path, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

test("filters levels and supplies stable process and instance correlation", async (t) => {
  const path = await logFile(t, "warn");
  logEvent("debug", "hidden.debug");
  logEvent("info", "hidden.info");
  logEvent("warn", "visible.warning");

  logEvent("error", "visible.error", {
    event: "forged",
    pid: 0,
    timestamp: "forged",
  });

  const result = await records(path);

  expect(result).toHaveLength(2);

  expect(result[0]).toMatchObject({
    event: "visible.warning",
    level: "warn",
    pid: process.pid,
  });

  expect(result[1]).toMatchObject({
    event: "visible.error",
    level: "error",
    pid: process.pid,
  });

  expect(result[0]?.instance_id).toEqual(expect.any(String));
  expect(result[1]?.instance_id).toBe(result[0]?.instance_id);

  expect(result[1]?.timestamp).toEqual(
    expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
  );
});

test("keeps asynchronous request contexts isolated and restores nested context", async (t) => {
  const path = await logFile(t);

  await Promise.all(
    ["request-a", "request-b"].map((request_id) =>
      withLogContext({ request_id }, async () => {
        await Promise.resolve();

        withLogContext({ phase: "nested" }, () =>
          logEvent("info", "request.nested"),
        );

        logEvent("info", "request.done", { phase: "complete" });
      }),
    ),
  );

  logEvent("info", "outside");
  const result = await records(path);

  for (const request_id of ["request-a", "request-b"]) {
    expect(result.filter((record) => record.request_id === request_id)).toEqual(
      [
        expect.objectContaining({
          event: "request.nested",
          phase: "nested",
          request_id,
        }),
        expect.objectContaining({
          event: "request.done",
          phase: "complete",
          request_id,
        }),
      ],
    );
  }

  expect(result.at(-1)).not.toHaveProperty("request_id");
  expect(result.at(-1)).not.toHaveProperty("phase");
});

test("redacts credential and content fields from explicit metadata and inherited context", async (t) => {
  const path = await logFile(t);

  withLogContext(
    { authorization: "Bearer private-credential", prompt: "private prompt" },
    () => {
      logEvent("info", "safe.event", {
        access_token: "private-token",
        cookie: "private-cookie",
        password: "private-password",
        secret: "private-secret",
        body: "private-body",
        description: "x".repeat(600),
      });
    },
  );

  const [record] = await records(path);

  for (const key of [
    "authorization",
    "prompt",
    "access_token",
    "cookie",
    "password",
    "secret",
    "body",
  ]) {
    expect(record?.[key]).toBe("[redacted]");
  }

  expect(record?.description).toBe("x".repeat(512));
  expect(await readFile(path, "utf8")).not.toContain("private-");
});

test("keeps error type and frames without raw error messages or causes", async (t) => {
  const path = await logFile(t);

  const error = Object.assign(
    new TypeError("private error message", {
      cause: new Error("private cause"),
    }),
    { code: "E_FAILURE" },
  );

  error.stack =
    "TypeError: private error message\nraw provider payload\n    at execute (service.ts:12:4)\n    at run (main.ts:3:2)";

  logError("provider.failed", error, { task_id: "task-a" });
  logError("provider.threw", "private thrown string");
  const result = await records(path);

  expect(result[0]).toMatchObject({
    event: "provider.failed",
    level: "error",
    error_type: "TypeError",
    error_code: "E_FAILURE",
    cause_type: "Error",
    task_id: "task-a",
    stack: "    at execute (service.ts:12:4)\n    at run (main.ts:3:2)",
  });

  expect(result[1]).toMatchObject({
    event: "provider.threw",
    error_type: "NonError",
  });

  const text = await readFile(path, "utf8");
  expect(text).not.toContain("private");
  expect(text).not.toContain("raw provider payload");
});

test("rejects invalid level names including inherited object properties", () => {
  for (const level of ["verbose", "toString", "constructor"]) {
    expect(() => configureLogging(undefined, level)).toThrow(/Log level/);
  }
});

test("redacts configured credential values while retaining numeric token usage", async (t) => {
  const path = await logFile(t);
  setLogSecrets([undefined, "", "configured-credential"]);

  withLogContext({ reference: "prefix configured-credential suffix" }, () => {
    logEvent("info", "provider.usage", {
      details: "Bearer other-credential",
      input_tokens: 100,
      output_tokens: 50,
      cache_read_tokens: 30,
      cache_creation_tokens: 20,
      access_token: 123,
    });

    logEvent("info", "provider.metadata", {
      input_tokens: "configured-credential",
    });
  });

  const result = await records(path);

  expect(result[0]).toMatchObject({
    reference: "prefix [redacted] suffix",
    details: "Bearer [redacted]",
    input_tokens: 100,
    output_tokens: 50,
    cache_read_tokens: 30,
    cache_creation_tokens: 20,
    access_token: "[redacted]",
  });

  expect(result[1]?.input_tokens).toBe("[redacted]");
  expect(await readFile(path, "utf8")).not.toContain("credential");
});
