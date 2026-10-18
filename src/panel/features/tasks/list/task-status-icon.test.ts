// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, test } from "vitest";

import { TaskStatusIcon } from "./task-status-icon";

afterEach(cleanup);

function svgOf(container: HTMLElement): SVGSVGElement {
  const svg = container.querySelector("svg");
  assert.ok(svg);

  return svg;
}

test("running draws a glow and a filled dot without a path", () => {
  const { container } = render(
    createElement(TaskStatusIcon, { kind: "running", label: "Running" }),
  );

  const svg = svgOf(container);
  assert.ok(svg.classList.contains("row-status-icon"));
  assert.ok(svg.classList.contains("running"));
  assert.ok(svg.querySelector(".row-status-glow"));
  expect(svg.querySelector("path")).toBeNull();
});

test("queued draws a circle around the clock hands", () => {
  const { container } = render(
    createElement(TaskStatusIcon, { kind: "queued", label: "Queued" }),
  );

  const svg = svgOf(container);
  assert.ok(svg.querySelector("circle"));
  assert.ok(svg.querySelector("path"));
});

test("decorative status icons are hidden from assistive tech", () => {
  const { container } = render(
    createElement(TaskStatusIcon, {
      kind: "completed",
      label: "Completed",
      decorative: true,
    }),
  );

  const svg = svgOf(container);
  assert.equal(svg.getAttribute("aria-hidden"), "true");
  expect(svg.querySelector("title")).toBeNull();
});
