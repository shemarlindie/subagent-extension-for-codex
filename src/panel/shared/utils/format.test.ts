import assert from "node:assert/strict";

import { test } from "vitest";

import { formatBytes, formatCount } from "./format";

test("byte counts use the largest whole unit with one decimal place", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(20 * 1024 * 1024), "20 MB");
});

test("counts up to 999 stay as digits and larger counts abbreviate", () => {
  assert.equal(formatCount(0), "0");
  assert.equal(formatCount(999), "999");
  assert.equal(formatCount(1000), "1K");
  assert.equal(formatCount(1100), "1.1K");
  assert.equal(formatCount(2000), "2K");
  assert.equal(formatCount(1284), "1.3K");
  assert.equal(formatCount(999_000), "999K");
  assert.equal(formatCount(1_500_000), "1.5M");
});
