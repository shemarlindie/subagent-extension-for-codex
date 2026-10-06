// @vitest-environment jsdom
import assert from "node:assert/strict";

import { test } from "vitest";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  writable: true,
  value: true,
});

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";

import type { Controller } from "../../../shared/state/controller";
import { ControllerContext } from "../../../shared/state/controller-context";
import type { PreviewFile } from "../file-format";
import { FilePreview } from "./file-preview";

const controller = {
  transport: { embedded: true },
  report: () => {},
} as unknown as Controller;

function show(file: PreviewFile) {
  return render(
    createElement(
      ControllerContext.Provider,
      { value: controller },
      createElement(FilePreview, { file }),
    ),
  );
}

test("a file opens in its best view and switches to Source", async (t) => {
  t.onTestFinished(cleanup);

  const view = show({
    path: "docs/notes.md",
    content: "# Notes\n\nSee `scan.ts`.",
  });

  view.getByText("notes.md");
  view.getByText("Markdown");
  assert.ok(view.container.querySelector(".markdown-body h1"));
  // Only the active view renders.
  assert.equal(view.container.querySelector(".code-view"), null);

  await userEvent.click(screen.getByRole("button", { name: "Source" }));

  await waitFor(() =>
    assert.equal(
      view.container
        .querySelector(".file-preview-body")
        ?.getAttribute("data-view"),
      "source",
    ),
  );

  assert.equal(view.container.querySelector(".markdown-body"), null);
  assert.equal(view.container.querySelectorAll(".code-line").length, 3);
});

test("diffs render each file with old and new line numbers", (t) => {
  t.onTestFinished(cleanup);

  const view = show({
    path: "changes.diff",
    content:
      "diff --git a/auth.ts b/auth.ts\n--- a/auth.ts\n+++ b/auth.ts\n@@ -1 +1 @@\n-const ttl = 59;\n+const ttl = 60;",
  });

  assert.deepEqual(
    [...view.container.querySelectorAll(".diff-row")].map((row) => [
      row.className,
      row.textContent,
    ]),
    [
      ["diff-row del", "1−const ttl = 59;"],
      ["diff-row add", "1+const ttl = 60;"],
    ],
  );
});

test("long files and tables render in full", (t) => {
  t.onTestFinished(cleanup);

  const lines = Array.from({ length: 6000 }, (_, index) => `line ${index}`);
  const log = show({ path: "build.log", content: lines.join("\n") });
  assert.equal(log.container.querySelectorAll(".code-line").length, 6000);
  cleanup();

  const rows = ["n", ...Array.from({ length: 6000 }, (_, i) => String(i))];
  const table = show({ path: "rows.csv", content: rows.join("\n") });
  assert.equal(table.container.querySelectorAll("tbody tr").length, 6000);
});

test("an SVG over 64 KB shows as source with a note, never as an image", (t) => {
  t.onTestFinished(cleanup);

  const view = show({
    path: "graph.svg",
    content: `<svg xmlns="http://www.w3.org/2000/svg">${"<g/>".repeat(17_000)}</svg>`,
  });

  view.getByText(/over 64 KB, so it is shown as source only/);
  assert.equal(view.container.querySelector("img"), null);
  assert.ok(view.container.querySelector(".code-view"));
  assert.equal(screen.queryByRole("button", { name: "Image" }), null);
});

test("raster images render from base64 without a Source view", (t) => {
  t.onTestFinished(cleanup);

  const view = show({ path: "shot.png", content: "AAAA" });

  assert.equal(
    view.container.querySelector("img")?.getAttribute("src"),
    "data:image/png;base64,AAAA",
  );

  assert.equal(screen.queryByRole("button", { name: "Source" }), null);
});
