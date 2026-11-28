import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { test } from "vitest";

const roots = [
  "src/main.ts",
  "src/hosts/codex/service/stdio.ts",
  "src/panel/app/app.ts",
  "dev/register-providers.ts",
];

// The proxy's settings tools and the panel's settings form must accept the
// same provider settings as the service, and tests should run against the
// providers production registers. Importing a root would start the service,
// proxy or panel, so this reads their source.
test("composition roots register the same providers", () => {
  const lists = roots.map((root) => {
    const source = readFileSync(
      new URL(`../../../${root}`, import.meta.url),
      "utf8",
    );

    const calls = [...source.matchAll(/registerProviders\(\[([^\]]*)\]\)/g)];
    assert.equal(calls.length, 1, `${root} registers providers once`);

    return calls[0][1].replace(/\s+/g, "");
  });

  assert.deepEqual(
    Object.fromEntries(roots.map((root, i) => [root, lists[i]])),
    Object.fromEntries(roots.map((root) => [root, lists[0]])),
  );
});
