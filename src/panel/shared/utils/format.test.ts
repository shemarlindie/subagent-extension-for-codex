import assert from "node:assert/strict";

import { test } from "vitest";

import { formatBytes } from "./format";

test("byte counts use the largest whole unit with one decimal place", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(20 * 1024 * 1024), "20 MB");
});
