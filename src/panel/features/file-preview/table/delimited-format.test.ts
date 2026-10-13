import assert from "node:assert/strict";

import { test } from "vitest";

import { parseDelimited } from "./delimited-format";

test("delimited text honors quotes, escaped quotes and embedded newlines", () => {
  assert.deepEqual(parseDelimited('a,b\n1,"x, ""y""\nz"\r\n2,\n'), [
    ["a", "b"],
    ["1", 'x, "y"\nz'],
    ["2", ""],
  ]);

  assert.deepEqual(parseDelimited("a\tb\n1\t2", "\t"), [
    ["a", "b"],
    ["1", "2"],
  ]);
});

test("delimited text drops a byte order mark", () => {
  assert.deepEqual(parseDelimited("\uFEFFa,b\r\n1,2\r\n"), [
    ["a", "b"],
    ["1", "2"],
  ]);
});
