// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render } from "@testing-library/react";
import { expect, onTestFinished, test } from "vitest";

import { TabLabel } from "./tab-label";

const label = (container: HTMLElement) =>
  container.querySelector<HTMLElement>(".tab-label");

test("a count shows beside its label", () => {
  onTestFinished(cleanup);

  const view = render(<TabLabel count={3}>Changes</TabLabel>);

  assert.equal(view.container.querySelector(".tab-count")?.textContent, "3");
  assert.equal(label(view.container)?.textContent?.trim(), "Changes 3");
});

test("a zero count shows no count", () => {
  onTestFinished(cleanup);

  const view = render(<TabLabel count={0}>Activity</TabLabel>);

  expect(view.container.querySelector(".tab-count")).toBeNull();
  assert.equal(label(view.container)?.textContent?.trim(), "Activity");
});

test("a new count replaces the one shown", () => {
  onTestFinished(cleanup);

  const view = render(<TabLabel count={3}>Changes</TabLabel>);

  view.rerender(<TabLabel count={4}>Changes</TabLabel>);

  assert.equal(view.container.querySelector(".tab-count")?.textContent, "4");
});
