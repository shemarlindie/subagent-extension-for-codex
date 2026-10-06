import assert from "node:assert/strict";

import { test } from "vitest";

import {
  fileBytes,
  fileFormat,
  fileViews,
  parseDelimited,
  parseDiffFiles,
} from "../../features/file-preview/file-format";
import { highlightLines } from "../../features/file-preview/highlight";
import { largeFiles } from "./large-files";

const byPath = () =>
  Object.fromEntries(largeFiles().map((file) => [file.path, file]));

test("each large file is detected as its format", () => {
  assert.deepEqual(
    largeFiles().map((file) => [file.path, fileFormat(file)]),
    [
      ["changes.diff", "diff"],
      ["dist/bundle-stats.json", "json"],
      ["reports/module-sizes.csv", "csv"],
      ["logs/build.log", "text"],
      ["docs/performance-notes.md", "markdown"],
      ["dist/vendor.min.js", "code"],
      ["docs/dependency-graph.svg", "image"],
    ],
  );
});

test("large files cross the limits their viewers handle", () => {
  const files = byPath();

  assert.equal(parseDiffFiles(files["changes.diff"].content).length, 60);
  assert.ok(!files["dist/bundle-stats.json"].content.includes("\n"));

  assert.equal(
    parseDelimited(files["reports/module-sizes.csv"].content).length,
    20_001,
  );

  const log = files["logs/build.log"].content;
  assert.ok(log.length > 200_000);
  // Past the highlighting limit, every line is still shown.
  assert.equal(highlightLines(log.trimEnd()).length, 30_000);

  assert.ok(files["docs/performance-notes.md"].content.length > 100_000);
  assert.ok(files["dist/vendor.min.js"].content.length >= 250_000);
});

test("an SVG over 64 KB shows as source only", () => {
  const svg = byPath()["docs/dependency-graph.svg"];

  assert.ok(fileBytes(svg) > 64 * 1024);
  assert.deepEqual(fileViews(svg), ["source"]);
});
