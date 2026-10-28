import assert from "node:assert/strict";

import { test } from "vitest";

import { diffPath, diffRows, parseDiffFiles } from "./diff-format";

test("paths Git quoted in a diff parse as the paths themselves", () => {
  // As Git writes them: a tab, a quote and backslashes, then octal UTF-8.
  const files =
    parseDiffFiles(String.raw`diff --git "a/tab\tname.ts" "b/tab\tname.ts"
--- "a/tab\tname.ts"
+++ "b/tab\tname.ts"
@@ -1 +1 @@
-y
+y2
diff --git "a/we\"ird\\\\na me.ts" "b/we\"ird\\\\na me.ts"
--- "a/we\"ird\\\\na me.ts"${"\t"}
+++ "b/we\"ird\\\\na me.ts"${"\t"}
@@ -1 +1 @@
-x
+x2
diff --git "a/caf\303\251.ts" "b/caf\303\251.ts"
--- "a/caf\303\251.ts"
+++ "b/caf\303\251.ts"
@@ -1 +1 @@
-z
+z2
`);

  assert.deepEqual(files.map(diffPath), [
    "tab\tname.ts",
    'we"ird\\\\na me.ts',
    "café.ts",
  ]);
});

test("diff parsing handles deleted files, malformed input, notes and CRLF", () => {
  assert.deepEqual(parseDiffFiles("not a diff"), []);

  const [deleted] = parseDiffFiles(
    "diff --git a/gone.ts b/gone.ts\ndeleted file mode 100644\n--- a/gone.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-bye",
  );

  assert.ok(deleted);
  assert.equal(diffPath(deleted), "gone.ts");

  const [noNewline] = parseDiffFiles(
    "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n",
  );

  assert.ok(noNewline);

  assert.deepEqual(diffRows(noNewline), [
    { kind: "hunk", content: "@@ -1 +1 @@" },
    { kind: "line", type: "del", oldLine: 1, newLine: undefined, text: "a" },
    { kind: "note", content: "No newline at end of file" },
    { kind: "line", type: "add", oldLine: undefined, newLine: 1, text: "b" },
  ]);

  const [crlf] = parseDiffFiles(
    "diff --git a/y b/y\r\n--- a/y\r\n+++ b/y\r\n@@ -1 +1 @@\r\n-a\r\n+b\r\n",
  );

  assert.ok(crlf);

  assert.deepEqual(
    diffRows(crlf).map((row) => ("text" in row ? row.text : row.content)),
    ["@@ -1 +1 @@", "a", "b"],
  );
});
