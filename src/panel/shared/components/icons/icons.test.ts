// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, test } from "vitest";

import { TaskStatusIcon } from "../../../features/tasks/list/task-status-icon";
import { Chevron } from "../chevron";
import { Icon, type IconName, ICONS } from "./icons";

afterEach(cleanup);

function svgOf(container: HTMLElement): SVGSVGElement {
  const svg = container.querySelector("svg");
  assert.ok(svg);

  return svg;
}

describe("Icon", () => {
  test("renders every catalog entry on one full canvas at one default size", () => {
    for (const name of Object.keys(ICONS) as IconName[]) {
      const { container } = render(createElement(Icon, { name }));
      const svg = svgOf(container);
      assert.equal(svg.getAttribute("aria-hidden"), "true", name);
      assert.equal(svg.getAttribute("role"), null, name);
      assert.equal(svg.getAttribute("viewBox"), "0 0 24 24", name);
      assert.equal(svg.getAttribute("width"), "16", name);
      assert.equal(svg.getAttribute("height"), "16", name);
      expect(svg.querySelector("g[transform]")).toBeNull();
      assert.ok(svg.querySelector("path, circle, rect"), name);
      cleanup();
    }
  });

  test("keeps the select caret's size on the shared canvas", () => {
    const { container } = render(createElement(Chevron));
    const svg = svgOf(container);

    assert.equal(svg.getAttribute("viewBox"), "0 0 24 24");
    assert.equal(svg.getAttribute("width"), "12");
    assert.equal(svg.getAttribute("height"), "12");
    assert.equal(svg.getAttribute("stroke-width"), "3.429");

    assert.equal(
      container.querySelector(".chevron")?.getAttribute("class"),
      "chevron",
    );
  });

  test("label adds an accessible name and title", () => {
    const { container } = render(
      createElement(Icon, { name: "check", label: "Done" }),
    );

    const svg = svgOf(container);
    assert.equal(svg.getAttribute("role"), "img");
    assert.equal(svg.getAttribute("aria-label"), "Done");
    assert.equal(svg.getAttribute("aria-hidden"), null);
    assert.equal(svg.querySelector("title")?.textContent, "Done");
  });

  test("escapes labels inserted into the SVG markup", () => {
    const label = 'Done <path>unsafe</path> & "quoted"';

    const { container } = render(createElement(Icon, { name: "check", label }));

    const svg = svgOf(container);
    assert.equal(svg.querySelector("title")?.textContent, label);
    expect(svg.querySelector("title path")).toBeNull();
  });

  test("size and strokeWidth override the catalog", () => {
    const { container } = render(
      createElement(Icon, { name: "check", size: 10, strokeWidth: 1 }),
    );

    const svg = svgOf(container);
    assert.equal(svg.getAttribute("width"), "10");
    assert.equal(svg.getAttribute("height"), "10");
    assert.equal(svg.getAttribute("stroke-width"), "1");
  });
});

describe("TaskStatusIcon", () => {
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
});
