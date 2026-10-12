// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { FilePreviewSkeleton } from "./file-preview-skeleton";

afterEach(cleanup);

function skeleton(kind: "deleted" | "binary", hasDiff: boolean) {
  return (
    <FilePreviewSkeleton
      format="code"
      kind={kind}
      hasDiff={hasDiff}
      viewCount={0}
      viewSwitcherTarget={null}
      loading
      actions={{ ask: true, copy: false, viewed: true }}
    />
  );
}

test("deleted files show their state and diff rows without file-view tabs", () => {
  const view = render(skeleton("deleted", true));

  expect(view.getByText("Deleted")).toBeTruthy();
  expect(view.container.querySelector(".diff-skeleton-rows")).not.toBeNull();

  expect(
    view.container.querySelector(".file-preview-skeleton-views"),
  ).toBeNull();

  expect(
    view.container.querySelector(".file-preview-skeleton-format"),
  ).toBeNull();

  expect(
    view.container.querySelector(".file-preview-skeleton-size"),
  ).toBeNull();
});

test("binary files use a compact state line and no file-view tabs", () => {
  const view = render(skeleton("binary", false));

  expect(
    view.container.querySelector(".file-preview-skeleton-state-line"),
  ).not.toBeNull();

  expect(
    view.container.querySelector(".file-preview-skeleton-views"),
  ).toBeNull();

  expect(
    view.container.querySelector(".file-preview-skeleton-format"),
  ).toBeNull();

  expect(
    view.container.querySelector(".file-preview-skeleton-code"),
  ).toBeNull();
});
