import assert from "node:assert/strict";

import { test } from "vitest";

import type { Artifact } from "../../shared/state/types";
import { formatBytes } from "../../shared/utils/format";
import {
  artifactBytes,
  artifactFileName,
  countDelimitedRows,
  headLines,
  parseDelimited,
  scanDiff,
  summarizeArtifact,
} from "./artifact-file";

function artifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: "art_1",
    task_id: "task",
    type: "report",
    title: "Worker result",
    content: "",
    mime_type: "text/plain",
    created_at: "",
    ...overrides,
  };
}

test("file names slug the title and keep titles that are already file names", () => {
  assert.equal(
    artifactFileName(
      artifact({
        type: "diff",
        title: "Repository diff · attempt 1",
        mime_type: "text/x-diff",
      }),
    ),
    "repository-diff-attempt-1.diff",
  );

  assert.equal(
    artifactFileName(
      artifact({ title: "Café notes", mime_type: "text/markdown" }),
    ),
    "cafe-notes.md",
  );

  assert.equal(artifactFileName(artifact({ title: "scan.ts" })), "scan.ts");

  assert.equal(
    artifactFileName(artifact({ type: "log", title: "Scan log" })),
    "scan-log.log",
  );

  assert.equal(artifactFileName(artifact({ title: "···" })), "report.txt");
});

test("sizes count UTF-8 bytes and decoded base64 images", () => {
  assert.equal(artifactBytes(artifact({ content: "é" })), 2);

  assert.equal(
    artifactBytes(artifact({ mime_type: "image/png", content: btoa("12345") })),
    5,
  );

  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(20 * 1024 * 1024), "20 MB");
});

test("the diff scanner counts every file but lists only the first ones", () => {
  const diff = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,2 +1,1 @@
--- this removed line looks like a header
-old
+new
diff --git a/old.ts b/new.ts
similarity index 90%
rename from old.ts
rename to new.ts
diff --git a/gone.ts b/gone.ts
deleted file mode 100644
--- a/gone.ts
+++ /dev/null
@@ -1 +0,0 @@
-bye
\\ No newline at end of file
diff --git a/fresh.ts b/fresh.ts
new file mode 100644
--- /dev/null
+++ b/fresh.ts
@@ -0,0 +1 @@
+hi
`;

  assert.deepEqual(scanDiff(diff), {
    files: [
      {
        path: "a.ts",
        status: "modified",
        additions: 1,
        deletions: 2,
      },
      {
        path: "new.ts",
        from: "old.ts",
        status: "renamed",
        additions: 0,
        deletions: 0,
      },
      { path: "gone.ts", status: "deleted", additions: 0, deletions: 1 },
      { path: "fresh.ts", status: "added", additions: 1, deletions: 0 },
    ],
    total_files: 4,
    additions: 2,
    deletions: 3,
  });

  const listed = scanDiff(diff, 1);
  assert.equal(listed.files.length, 1);
  assert.equal(listed.total_files, 4);
  assert.equal(listed.deletions, 3);

  // A hunk header that overstates its lines still ends at the next file.
  assert.equal(
    scanDiff(
      "diff --git a/x b/x\n@@ -1,9 +1,9 @@\n-a\n+b\ndiff --git a/y b/y\n@@ -1 +1 @@\n-c\n+d\n",
    ).total_files,
    2,
  );

  // A plain unified diff has no "diff --git" lines.
  assert.deepEqual(
    scanDiff(
      "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n--- a/y\n+++ b/y\n@@ -1 +1 @@\n-c\n+d\n",
    ).files.map((file) => file.path),
    ["x", "y"],
  );
});

test("snippet helpers read only the start of the content", () => {
  assert.equal(headLines("a\nb\nc\n", 2), "a\nb");
  assert.equal(headLines("a\nb\n", 5), "a\nb");
  assert.equal(headLines("x".repeat(1000), 1, 10), "x".repeat(10));

  assert.deepEqual(parseDelimited("h\n1\n2\n3\n", ",", 2), [["h"], ["1"]]);
  assert.equal(countDelimitedRows('h,n\n1,"a\nb"\n2,c'), 3);
  assert.equal(countDelimitedRows("h\n1\n"), 2);
});

test("summaries hold bounded snippets and flag worker reports", () => {
  const minified = summarizeArtifact(
    artifact({
      title: "Worker result",
      mime_type: "application/json",
      content: JSON.stringify({
        summary: "Done",
        findings: Array.from({ length: 50 }, (_, index) => `finding ${index}`),
        evidence: [],
        changes: [],
        tests: [],
        recommendations: [],
      }),
    }),
  );

  assert.equal(minified.report, true);
  assert.equal(minified.file_name, "worker-result.json");
  assert.equal(minified.format, "json");

  assert.deepEqual(minified.snippet, {
    kind: "lines",
    language: "json",
    text: '{\n  "summary": "Done",\n  "findings": [\n    "finding 0",\n    "finding 1",\n    "finding 2",\n    "finding 3",\n    "finding 4",',
  });

  const csv = summarizeArtifact(
    artifact({
      mime_type: "text/csv",
      content: ["h", ...Array.from({ length: 100 }, (_, i) => String(i))].join(
        "\n",
      ),
    }),
  );

  assert.deepEqual(csv.snippet, {
    kind: "table",
    rows: [["h"], ["0"], ["1"], ["2"], ["3"]],
    total_rows: 101,
  });

  // Only service thumbnails or small SVGs become image snippets.
  assert.deepEqual(
    summarizeArtifact(artifact({ mime_type: "image/png", content: "AAAA" }))
      .snippet,
    { kind: "none" },
  );

  assert.deepEqual(
    summarizeArtifact(
      artifact({ mime_type: "image/svg+xml", content: "x".repeat(70_000) }),
    ).snippet,
    { kind: "none" },
  );

  assert.ok(!("content" in summarizeArtifact(artifact({ content: "secret" }))));
});
