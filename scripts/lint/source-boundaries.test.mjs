import { expect, test } from "vitest";

import { sourceBoundaries } from "./source-boundaries.mjs";

function reportsFor(filename, node) {
  const reports = [];

  const visitor = sourceBoundaries.create({
    cwd: process.cwd(),
    filename: `${process.cwd()}/${filename}`,
    report: (report) => reports.push(report),
  });

  visitor.ImportDeclaration(node);

  return reports;
}

const sdkImport = (importKind) => ({
  type: "ImportDeclaration",
  importKind,
  source: { value: "@anthropic-ai/claude-agent-sdk" },
});

test("the Claude-owned shared provider contract may import SDK types only", () => {
  expect(
    reportsFor("src/shared/providers/claude/events.ts", sdkImport("type")),
  ).toEqual([]);

  expect(
    reportsFor("src/shared/providers/claude/events.ts", sdkImport("value")),
  ).toHaveLength(1);
});

test("generic shared modules cannot depend on the Claude SDK, even by type", () => {
  expect(
    reportsFor("src/shared/events/types.ts", sdkImport("type")),
  ).toHaveLength(1);
});
