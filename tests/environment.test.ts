import assert from "node:assert/strict";

import { test } from "vitest";

import { detectEnvironment } from "../ui/environment";

function page(options: {
  embedded?: boolean;
  origin?: string;
  search?: string;
}) {
  const win = {
    CODEX_SUBAGENT_EXTENSION_ORIGIN: options.origin,
    location: { search: options.search ?? "" },
  } as unknown as Window & { CODEX_SUBAGENT_EXTENSION_ORIGIN?: string };

  (win as { parent: unknown }).parent = options.embedded ? {} : win;

  return detectEnvironment(win);
}

test("an iframe always talks to its host", () => {
  assert.deepEqual(page({ embedded: true }), { kind: "host" });

  assert.deepEqual(page({ embedded: true, origin: "http://x" }), {
    kind: "host",
  });

  assert.deepEqual(page({ embedded: true, search: "?preview=1" }), {
    kind: "host",
  });
});

test("a top-level page with an injected origin uses HTTP", () => {
  assert.deepEqual(page({ origin: "http://127.0.0.1:1" }), {
    kind: "http",
    origin: "http://127.0.0.1:1",
  });
});

test("preview applies only to a top-level page", () => {
  assert.deepEqual(page({ search: "?preview=1" }), { kind: "preview" });
});

test("a top-level page with no origin or the unreplaced placeholder is unsupported", () => {
  assert.deepEqual(page({}), { kind: "unsupported" });

  assert.deepEqual(page({ origin: "__API_ORIGIN__" }), {
    kind: "unsupported",
  });
});
