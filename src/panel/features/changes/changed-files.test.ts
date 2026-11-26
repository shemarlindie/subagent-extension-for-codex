import assert from "node:assert/strict";

import { test } from "vitest";

import type { ListedChange } from "./types";
import { nextUnviewed } from "./use-viewed-files";

const file = (path: string): ListedChange => ({
  path,
  status: "modified",
  additions: 1,
  deletions: 1,
  source: "tool",
  incomplete: false,
  signature: `${path}:1`,
  hunks: 1,
  lines: 2,
});

test("the next unread file follows the current one, wrapping to the start", () => {
  const files = [file("a.ts"), file("logo.png"), file("b.ts")];
  const [a, logo, b] = files;
  assert.ok(a && logo && b);

  const viewed = (...files: ListedChange[]) =>
    new Map(files.map((file) => [file.path, file.signature]));

  assert.equal(nextUnviewed(viewed(), files, a), logo);
  assert.equal(nextUnviewed(viewed(logo), files, a), b);
  assert.equal(nextUnviewed(viewed(a), files, b), logo);
  // None left but the current file.
  assert.equal(nextUnviewed(viewed(logo, b), files, a), undefined);
});
