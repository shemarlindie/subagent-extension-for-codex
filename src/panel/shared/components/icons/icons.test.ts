// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { svgPathBbox } from "svg-path-bbox";
import { afterEach, describe, expect, test } from "vitest";

import { Icon } from "./icons";

afterEach(cleanup);

function svgOf(container: HTMLElement): SVGSVGElement {
  const svg = container.querySelector("svg");
  assert.ok(svg);

  return svg;
}

const iconSources = import.meta.glob<string>(
  "../../../../../assets/icons/*.svg",
  { eager: true, query: "?raw", import: "default" },
);

type Bounds = [minX: number, minY: number, maxX: number, maxY: number];

const VIEWBOX = 24;
const TOLERANCE = 0.05;

function shapeBounds(shape: Element): Bounds {
  const value = (name: string) => Number(shape.getAttribute(name) ?? 0);

  switch (shape.tagName) {
    case "path":
      return svgPathBbox(shape.getAttribute("d") ?? "");

    case "circle": {
      const [cx, cy, r] = [value("cx"), value("cy"), value("r")];

      return [cx - r, cy - r, cx + r, cy + r];
    }

    case "rect": {
      const [x, y] = [value("x"), value("y")];

      return [x, y, x + value("width"), y + value("height")];
    }

    default:
      throw new Error(`unsupported <${shape.tagName}>`);
  }
}

// Icon draws every stroke with round caps and joins, so the inked artwork
// extends exactly half the stroke width past each shape's geometry.
function inkedBounds(source: string): Bounds {
  const svg = new DOMParser().parseFromString(
    source,
    "image/svg+xml",
  ).documentElement;

  const halfStroke = Number(svg.getAttribute("stroke-width")) / 2;
  const bounds: Bounds = [Infinity, Infinity, -Infinity, -Infinity];

  for (const element of svg.querySelectorAll("*")) {
    if (element.hasAttribute("transform")) {
      throw new Error("transforms are unsupported");
    }

    if (element.tagName === "g") continue;

    const pad =
      element.closest("[stroke]")?.getAttribute("stroke") === "none"
        ? 0
        : halfStroke;

    const [minX, minY, maxX, maxY] = shapeBounds(element);
    bounds[0] = Math.min(bounds[0], minX - pad);
    bounds[1] = Math.min(bounds[1], minY - pad);
    bounds[2] = Math.max(bounds[2], maxX + pad);
    bounds[3] = Math.max(bounds[3], maxY + pad);
  }

  return bounds;
}

function fitProblems([minX, minY, maxX, maxY]: Bounds): string[] {
  const problems: string[] = [];

  if (
    Math.min(minX, minY) < -TOLERANCE ||
    Math.max(maxX, maxY) > VIEWBOX + TOLERANCE
  ) {
    problems.push("overflows the viewBox");
  }

  const wide = maxX - minX >= maxY - minY;

  const [longMin, longMax, shortMin, shortMax] = wide
    ? [minX, maxX, minY, maxY]
    : [minY, maxY, minX, maxX];

  if (longMax - longMin < VIEWBOX - TOLERANCE) {
    problems.push("does not reach the edges on its longer axis");
  }

  if (Math.abs(shortMin - (VIEWBOX - shortMax)) > TOLERANCE) {
    problems.push("is off-center on its shorter axis");
  }

  return problems;
}

describe("Icon", () => {
  test("escapes labels inserted into the SVG markup", () => {
    const label = 'Done <path>unsafe</path> & "quoted"';

    const { container } = render(createElement(Icon, { name: "check", label }));

    const svg = svgOf(container);
    assert.equal(svg.querySelector("title")?.textContent, label);
    expect(svg.querySelector("title path")).toBeNull();
  });

  test("artwork fills the viewBox on its longer axis and centers on the other", () => {
    const failures = Object.entries(iconSources).flatMap(([path, source]) => {
      const name = path.slice(path.lastIndexOf("/") + 1);

      try {
        return fitProblems(inkedBounds(source)).map(
          (problem) => `${name} ${problem}`,
        );
      } catch (error) {
        return [`${name}: ${(error as Error).message}`];
      }
    });

    expect(failures).toEqual([]);
  });
});
