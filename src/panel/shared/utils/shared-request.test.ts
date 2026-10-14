import assert from "node:assert/strict";

import { test } from "vitest";

import { sharedRequest } from "./shared-request";

test("concurrent callers share one request, and a later call starts another", async () => {
  let calls = 0;
  const read = sharedRequest(async () => ++calls);

  const first = read();
  assert.equal(read(), first);
  assert.equal(await first, 1);
  assert.equal(await read(), 2);

  // A failed request isn't reused either.
  const failing = sharedRequest(() =>
    Promise.reject(new Error(`failed ${++calls}`)),
  );

  await assert.rejects(failing(), /failed 3/);
  await assert.rejects(failing(), /failed 4/);
});
