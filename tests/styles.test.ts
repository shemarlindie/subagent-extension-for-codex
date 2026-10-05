import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

import { test } from "vitest";

test("shared.css imports every partial in ui/styles/shared exactly once", () => {
  const imports = [
    ...readFileSync("ui/styles/shared.css", "utf8").matchAll(
      /^@import "\.\/shared\/([^"]+)";$/gm,
    ),
  ].map((match) => match[1]);

  assert.deepEqual(
    [...imports].sort(),
    readdirSync("ui/styles/shared")
      .filter((file) => file.endsWith(".css"))
      .sort(),
  );
});
