import assert from "node:assert/strict";

import { test } from "vitest";

import { copyText } from "./copy-text";

test("copies text and returns true on success", async () => {
  const written: string[] = [];
  const reported: unknown[] = [];

  const copied = await copyText(
    "Notes",
    async (text) => void written.push(text),
    (error) => reported.push(error),
  );

  assert.equal(copied, true);
  assert.deepEqual(written, ["Notes"]);
  assert.deepEqual(reported, []);
});

test("reports a rejected clipboard write and resolves false", async () => {
  const denied = new Error("Clipboard access denied");
  const reported: unknown[] = [];

  const copied = await copyText(
    "Notes",
    async () => Promise.reject(denied),
    (error) => reported.push(error),
  );

  assert.equal(copied, false);
  assert.deepEqual(reported, [denied]);
});
