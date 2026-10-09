import assert from "node:assert/strict";

import { test } from "vitest";

import { highlightLines } from "./highlight";

test("highlighted lines reopen spans that cross line breaks and escape HTML", () => {
  const lines = highlightLines("/* one\ntwo */ const a = '<b>';", "javascript");

  assert.equal(lines.length, 2);

  for (const line of lines)
    assert.equal(
      line.match(/<span/g)?.length ?? 0,
      line.match(/<\/span>/g)?.length ?? 0,
      line,
    );

  assert.match(lines[1], /^<span class="hljs-comment">two \*\/<\/span>/);
  assert.match(lines[1], /&lt;b&gt;/);
  assert.deepEqual(highlightLines("<i>\nx", "unknown"), ["&lt;i&gt;", "x"]);
});

test("text past the highlighting limit is shown in full without colors", () => {
  const code = `const a = 1;\n${"x".repeat(200_000)}`;
  const lines = highlightLines(code, "javascript");

  assert.equal(lines.length, 2);
  assert.equal(lines[0], "const a = 1;");
});
