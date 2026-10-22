import assert from "node:assert/strict";

import { test } from "vitest";

import { copyText } from "./copy-text";

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
