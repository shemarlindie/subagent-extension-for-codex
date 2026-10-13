import assert from "node:assert/strict";

import { test } from "vitest";

import {
  baseMime,
  fileBadge,
  fileBytes,
  fileFormat,
  fileName,
  fileSource,
  fileViews,
  imageSource,
  pathLanguage,
  prettyJson,
  type PreviewFile,
} from "./file-format";

function file(path: string, content = "", mime_type?: string): PreviewFile {
  return { path, content, ...(mime_type ? { mime_type } : {}) };
}

test("formats come from the MIME type, then the extension", () => {
  const cases: [PreviewFile, string][] = [
    [file("data", "", "application/json"), "json"],
    [file("changes", "", "text/x-diff"), "diff"],
    [file("notes", "", "text/markdown; charset=utf-8"), "markdown"],
    [file("rows", "", "text/csv"), "csv"],
    [file("shot", "", "image/png"), "image"],
    [file("notes.md"), "markdown"],
    [file("rows.tsv"), "csv"],
    [file("data.json"), "json"],
    [file("fix.patch"), "diff"],
    [file("logo.svg"), "image"],
    [file("src/scan.ts"), "code"],
    [file("build.log"), "text"],
    [file("README"), "text"],
  ];

  for (const [input, format] of cases) {
    assert.equal(fileFormat(input), format, input.path);
  }

  assert.equal(baseMime(file("a.PNG")), "image/png");
  assert.equal(baseMime(file("a.txt")), "text/plain");
  assert.equal(baseMime(file("a.png", "", "Image/WebP; x=1")), "image/webp");
});

test("names and badges come from the path", () => {
  assert.equal(fileName("src/service/features/scan.ts"), "scan.ts");
  assert.equal(fileName("scan.ts"), "scan.ts");
  assert.equal(fileBadge("dir/report.json"), "JSON");
  assert.equal(fileBadge("dir/notes.markdown"), "MARK");
});

test("sizes count UTF-8 bytes and decoded base64 images", () => {
  assert.equal(fileBytes(file("a.txt", "é")), 2);
  assert.equal(fileBytes(file("a.txt", "😀")), 4);
  assert.equal(fileBytes(file("a.png", btoa("12345"))), 5);
});

test("images become data URLs: base64 for rasters, encoded markup for SVG", () => {
  assert.equal(
    imageSource(file("a.png", " AAAA\n")),
    "data:image/png;base64,AAAA",
  );

  assert.equal(
    imageSource(file("a.svg", "<svg/>")),
    "data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E",
  );
});

test("views follow the format, best first", () => {
  assert.deepEqual(fileViews(file("a.json", "{}")), ["source"]);
  assert.deepEqual(fileViews(file("a.md")), ["preview", "source"]);
  assert.deepEqual(fileViews(file("a.csv")), ["table", "source"]);
  assert.deepEqual(fileViews(file("a.png")), ["image"]);
  assert.deepEqual(fileViews(file("a.svg", "<svg/>")), ["image", "source"]);

  // Large SVGs are never rendered as images.
  assert.deepEqual(fileViews(file("a.svg", "x".repeat(64 * 1024 + 1))), [
    "source",
  ]);

  assert.deepEqual(fileViews(file("a.ts")), ["source"]);
  assert.deepEqual(fileViews(file("a.diff", "not a diff")), ["source"]);

  assert.deepEqual(
    fileViews(file("a.diff", "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n")),
    ["diff", "source"],
  );
});

test("the source view reformats minified JSON and picks a language", () => {
  assert.deepEqual(fileSource(file("a.json", '{"a":1}')), {
    code: '{\n  "a": 1\n}',
    language: "json",
  });

  assert.equal(fileSource(file("a.json", '{\n"a":1}')).code, '{\n"a":1}');
  assert.equal(fileSource(file("a.py")).language, "python");
  assert.equal(fileSource(file("a.svg")).language, "xml");
  assert.equal(fileSource(file("a.log")).language, undefined);
});

test("JSON is pretty-printed only when it parses", () => {
  assert.equal(prettyJson('{"a":1}'), '{\n  "a": 1\n}');
  assert.equal(prettyJson("{oops"), "{oops");
});

test("files known by name get a language", () => {
  assert.equal(pathLanguage("build/Dockerfile"), "dockerfile");
  assert.equal(pathLanguage("Makefile"), "makefile");
  assert.equal(pathLanguage("deploy.ps1"), "powershell");
  assert.equal(pathLanguage("README"), undefined);
});
