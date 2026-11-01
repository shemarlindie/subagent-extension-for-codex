import assert from "node:assert/strict";

import { test } from "vitest";

import { detectEnvironment } from "./environment";

function page(options: { embedded?: boolean; origin?: string }) {
  const win = {
    SUBAGENT_EXTENSION_FOR_CODEX_ORIGIN: options.origin,
  } as unknown as Window & { SUBAGENT_EXTENSION_FOR_CODEX_ORIGIN?: string };

  (win as { parent: unknown }).parent = options.embedded ? {} : win;

  return detectEnvironment(win);
}

test("an iframe always talks to its host", () => {
  assert.deepEqual(page({ embedded: true }), { kind: "host" });

  assert.deepEqual(page({ embedded: true, origin: "http://x" }), {
    kind: "host",
  });
});

test("a top-level page with no origin or the unreplaced placeholder is unsupported", () => {
  assert.deepEqual(page({}), { kind: "unsupported" });

  assert.deepEqual(page({ origin: "__API_ORIGIN__" }), {
    kind: "unsupported",
  });
});
