import assert from "node:assert/strict";

import { test } from "vitest";

import { browseProject } from "../src/core/project-picker.js";

type Execute = NonNullable<Parameters<typeof browseProject>[0]>["execute"];

// The picker only uses the resolved stdout, so fakes skip the child-process handle.
const fake = (
  run: (...args: unknown[]) => Promise<{ stdout: string; stderr: string }>,
) => run as unknown as Execute;

test("native folder picker uses a fixed script and preserves folder-name spaces", async () => {
  const calls: unknown[][] = [];

  const result = await browseProject({
    platform: "darwin",
    execute: fake(async (...args) => {
      calls.push(args);

      return { stdout: "/repo/ project with spaces /\n", stderr: "" };
    }),
  });

  assert.deepEqual(result, { repository: "/repo/ project with spaces /" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "/usr/bin/osascript");
  const args = calls[0][1] as string[];
  assert.equal(args[0], "-e");
  assert.match(args[1], /choose folder/);
  assert.match(args[1], /on error number -128/);
  assert.deepEqual(calls[0][2], { timeout: 120000, maxBuffer: 16384 });
});

test("native folder cancellation returns no repository", async () => {
  assert.deepEqual(
    await browseProject({
      platform: "darwin",
      execute: fake(async () => ({ stdout: "\n", stderr: "" })),
    }),
    { repository: null },
  );
});

test("unsupported hosts retain manual registration without executing a picker", async () => {
  let executed = false;

  await assert.rejects(
    browseProject({
      platform: "linux",
      execute: fake(async () => {
        executed = true;

        return { stdout: "", stderr: "" };
      }),
    }),
    /absolute repository path/i,
  );

  assert.equal(executed, false);
});

test("picker rejects overlapping requests and releases its lock after errors", async () => {
  let fail!: (error: Error) => void;

  const pending = browseProject({
    platform: "darwin",
    execute: fake(
      async () =>
        new Promise<{ stdout: string; stderr: string }>((_resolve, reject) => {
          fail = reject;
        }),
    ),
  });

  await assert.rejects(
    browseProject({
      platform: "darwin",
      execute: fake(async () => ({ stdout: "/repo/second\n", stderr: "" })),
    }),
    /already open/i,
  );

  fail(new Error("osascript failed"));
  await assert.rejects(pending, /osascript failed/);

  assert.deepEqual(
    await browseProject({
      platform: "darwin",
      execute: fake(async () => ({ stdout: "/repo/retry\n", stderr: "" })),
    }),
    { repository: "/repo/retry" },
  );
});
