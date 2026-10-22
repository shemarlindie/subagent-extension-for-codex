import assert from "node:assert/strict";

import { test } from "vitest";

import { retryable } from "./service-client.js";

test("retries refused connections always, and resets only for read-only calls", () => {
  const error = (code: string) => ({ cause: { code } });

  assert.equal(retryable(error("ECONNREFUSED")), true);
  assert.equal(retryable(error("ECONNRESET")), false);
  assert.equal(retryable(error("ECONNRESET"), true), true);
  assert.equal(retryable(error("UND_ERR_SOCKET"), true), true);
  assert.equal(retryable(error("ETIMEDOUT"), true), false);
});
