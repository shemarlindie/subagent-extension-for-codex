// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, test } from "vitest";

import { Icon } from "./icons";

afterEach(cleanup);

function svgOf(container: HTMLElement): SVGSVGElement {
  const svg = container.querySelector("svg");
  assert.ok(svg);

  return svg;
}

describe("Icon", () => {
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
});
