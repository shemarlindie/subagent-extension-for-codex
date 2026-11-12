import { expect, test } from "vitest";

import { normalizeCwd, parseOrgPolicy } from "./host-helpers";

test("a partial org policy gets the fields the panel reads, and other JSON none", () => {
  expect(parseOrgPolicy('{"default_effort": "high"}')).toEqual({
    managed: true,
    blocked: [],
    notes: [],
    default_effort: "high",
  });

  for (const none of ["", "{ nope", "[]", "null"]) {
    expect(parseOrgPolicy(none)).toBeUndefined();
  }
});

test("a typed cwd becomes the file URI Codex sends", () => {
  expect(normalizeCwd("  /repo/src ")).toBe("file:///repo/src");
  // Spaces, "#" and "?" are escaped so the path survives the round trip.
  const uri = normalizeCwd("/a b/#x?y");
  expect(uri).toBe("file:///a%20b/%23x%3Fy");
  expect(decodeURIComponent(new URL(uri).pathname)).toBe("/a b/#x?y");

  for (const kept of ["file:///repo", "", "relative/path"]) {
    expect(normalizeCwd(kept)).toBe(kept);
  }
});
