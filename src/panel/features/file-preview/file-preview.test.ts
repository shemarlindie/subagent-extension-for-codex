// @vitest-environment jsdom
import assert from "node:assert/strict";

import { expect, test } from "vitest";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  writable: true,
  value: true,
});

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";

import type { Controller } from "../../app/state/controller";
import { ControllerContext } from "../../app/state/controller-context";
import { type ParsedDiffFile, parseDiffFiles } from "./diff/diff-format";
import { type PreviewFile } from "./file-format";
import { FilePreview } from "./file-preview";

const controller = {
  transport: { embedded: true },
  report: () => {},
} as unknown as Controller;

const preview = (file: PreviewFile, diff?: ParsedDiffFile) =>
  createElement(
    ControllerContext.Provider,
    { value: controller },
    createElement(FilePreview, { file, diff }),
  );

const show = (file: PreviewFile) => render(preview(file));

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
  expect(view.container.querySelector(".code-view")).toBeNull();

  await userEvent.click(screen.getByRole("button", { name: "Source" }));

  await waitFor(() =>
    assert.equal(
      view.container
        .querySelector(".file-preview-body")
        ?.getAttribute("data-view"),
      "source",
    ),
  );

  expect(view.container.querySelector(".markdown-body")).toBeNull();
  assert.equal(view.container.querySelectorAll(".code-line").length, 3);
});

test("a new file without the chosen view opens in its best view", async (t) => {
  t.onTestFinished(cleanup);

  const view = show({ path: "rows.csv", content: "a,b\n1,2" });
  await userEvent.click(screen.getByRole("button", { name: "Source" }));
  view.rerender(preview({ path: "shot.png", content: "AAAA" }));

  await waitFor(() =>
    assert.equal(
      view.container
        .querySelector(".file-preview-body")
        ?.getAttribute("data-view"),
      "image",
    ),
  );

  assert.ok(view.container.querySelector("img"));
});

test("a file with its own diff adds a Diff view after its format's views", async (t) => {
  t.onTestFinished(cleanup);

  const [diff] = parseDiffFiles(
    "diff --git a/notes.md b/notes.md\n--- a/notes.md\n+++ b/notes.md\n@@ -1 +1 @@\n-# Old\n+# Notes",
  );

  const view = render(preview({ path: "notes.md", content: "# Notes" }, diff));

  assert.deepEqual(
    screen.getAllByRole("button").map((button) => button.textContent),
    ["Preview", "Source", "Diff"],
  );

  assert.ok(view.container.querySelector(".markdown-body h1"));

  await userEvent.click(screen.getByRole("button", { name: "Diff" }));

  await waitFor(() =>
    assert.deepEqual(
      [...view.container.querySelectorAll(".diff-row")].map(
        (row) => row.textContent,
      ),
      ["1−# Old", "1+# Notes"],
    ),
  );
});

test("source and table rows survive multiple lazy blocks", (t) => {
  t.onTestFinished(cleanup);

  // Cross two 200-row block boundaries without rendering thousands of DOM nodes.
  const lines = Array.from({ length: 401 }, (_, index) => `line ${index}`);
  const log = show({ path: "build.log", content: lines.join("\n") });
  assert.equal(log.container.querySelectorAll(".code-line").length, 401);
  cleanup();

  const rows = ["n", ...Array.from({ length: 401 }, (_, i) => String(i))];
  const table = show({ path: "rows.csv", content: rows.join("\n") });
  assert.equal(table.container.querySelectorAll("tbody tr").length, 401);
});

test("an SVG over 64 KB shows as source with a note, never as an image", (t) => {
  t.onTestFinished(cleanup);

  const view = show({
    path: "graph.svg",
    content: `<svg xmlns="http://www.w3.org/2000/svg">${"<g/>".repeat(17_000)}</svg>`,
  });

  view.getByText(/over 64 KB, so it is shown as source only/);
  expect(view.container.querySelector("img")).toBeNull();
  assert.ok(view.container.querySelector(".code-view"));
  expect(screen.queryByRole("button", { name: "Image" })).toBeNull();
});

test("table rows wider than the header keep every cell", (t) => {
  t.onTestFinished(cleanup);
  const table = show({ path: "ragged.csv", content: "a,b\n1,2,3\n4" });

  expect(
    [...table.container.querySelectorAll("tr")].map((row) =>
      [...row.children].map((cell) => cell.textContent),
    ),
  ).toEqual([
    ["a", "b", ""],
    ["1", "2", "3"],
    ["4", "", ""],
  ]);
});
