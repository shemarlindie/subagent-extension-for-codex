import assert from "node:assert/strict";

import { test } from "vitest";

import {
  fileBytes,
  fileFormat,
  fileViews,
  parseDelimited,
  parseDiffFiles,
} from "../../../src/panel/features/file-preview/file-format";
import { highlightLines } from "../../../src/panel/features/file-preview/highlight";
import { largeFiles } from "./large-files";

const fileAt = (path: string) => {
  const file = largeFiles().find((entry) => entry.path === path);
  assert.ok(file, `No large file at ${path}`);

  return file;
};

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
