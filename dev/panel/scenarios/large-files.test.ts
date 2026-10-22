import assert from "node:assert/strict";

import { test } from "vitest";

import { parseDiffFiles } from "../../../src/panel/features/file-preview/diff/diff-format";
import {
  fileBytes,
  fileViews,
} from "../../../src/panel/features/file-preview/file-format";
import { highlightLines } from "../../../src/panel/features/file-preview/highlight";
import { parseDelimited } from "../../../src/panel/features/file-preview/table/delimited-format";
import { largeFiles } from "./large-files";

const fileAt = (path: string) => {
  const file = largeFiles().find((entry) => entry.path === path);
  assert.ok(file, `No large file at ${path}`);

  return file;
};

test("large files cross the limits their viewers handle", () => {
  assert.equal(parseDiffFiles(fileAt("changes.diff").content).length, 60);
  assert.ok(!fileAt("dist/bundle-stats.json").content.includes("\n"));

  assert.equal(
    parseDelimited(fileAt("reports/module-sizes.csv").content).length,
    20_001,
  );

  const log = fileAt("logs/build.log").content;
  assert.ok(log.length > 200_000);
  // Past the highlighting limit, every line is still shown.
  assert.equal(highlightLines(log.trimEnd()).length, 30_000);

  assert.ok(fileAt("docs/performance-notes.md").content.length > 100_000);
  assert.ok(fileAt("dist/vendor.min.js").content.length >= 250_000);
});

test("an SVG over 64 KB shows as source only", () => {
  const svg = fileAt("docs/dependency-graph.svg");

  assert.ok(fileBytes(svg) > 64 * 1024);
  assert.deepEqual(fileViews(svg), ["source"]);
});
