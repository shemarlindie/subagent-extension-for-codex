import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

import { test } from "vitest";

test("app.css imports every stylesheet partial exactly once", () => {
  const imports = [
    ...readFileSync("ui/styles/app.css", "utf8").matchAll(
      /^@import "\.\/([^"]+)";$/gm,
    ),
  ].map((match) => match[1]);

  const partials = ["shared", "surfaces"].flatMap((dir) =>
    readdirSync(`ui/styles/${dir}`).map((file) => `${dir}/${file}`),
  );

  assert.deepEqual(
    [...imports].sort(),
    ["theme.css", "base.css", ...partials].sort(),
  );
});
