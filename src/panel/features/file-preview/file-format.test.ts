import assert from "node:assert/strict";

import { test } from "vitest";

import {
  baseMime,
  fileBytes,
  fileFormat,
  fileSource,
  fileViews,
  imageSource,
  type PreviewFile,
} from "./file-format";

function file(path: string, content = "", mime_type?: string): PreviewFile {
  return { path, content, ...(mime_type ? { mime_type } : {}) };
}

test("MIME metadata overrides extensions and ignores casing and parameters", () => {
  assert.equal(
    fileFormat(file("notes.txt", "", "text/markdown; charset=utf-8")),
    "markdown",
  );

  assert.equal(baseMime(file("a.PNG")), "image/png");
  assert.equal(fileFormat(file("a.avif")), "image");
  assert.equal(baseMime(file("a.txt")), "text/plain");
  assert.equal(baseMime(file("a.png", "", "Image/WebP; x=1")), "image/webp");
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

test("malformed diffs fall back to source", () => {
  assert.deepEqual(fileViews(file("a.diff", "not a diff")), ["source"]);

  assert.deepEqual(
    fileViews(file("a.diff", "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n")),
    ["diff", "source"],
  );
});

test("the source view formats minified JSON and preserves existing formatting", () => {
  assert.deepEqual(fileSource(file("a.json", '{"a":1}')), {
    code: '{\n  "a": 1\n}',
    language: "json",
  });

  assert.equal(fileSource(file("a.json", '{\n"a":1}')).code, '{\n"a":1}');
  assert.equal(fileSource(file("a.json", "{oops")).code, "{oops");
});
