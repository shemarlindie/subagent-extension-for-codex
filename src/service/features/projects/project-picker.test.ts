import assert from "node:assert/strict";

import { test } from "vitest";

import { browseProject } from "./project-picker.js";

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
  const [call] = calls;
  assert.equal(calls.length, 1);
  assert.ok(call);
  assert.equal(call[0], "/usr/bin/osascript");
  const [flag, script] = call[1] as string[];
  assert.equal(flag, "-e");
  assert.ok(script);
  assert.match(script, /choose folder/);
  assert.match(script, /on error number -128/);
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
    /absolute folder path/i,
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
