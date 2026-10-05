// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, test } from "vitest";

import { Chevron } from "../ui/components/chevron";
import { Icon, type IconName, ICONS } from "../ui/components/icons";
import { TaskStatusIcon } from "../ui/components/task-status-icon";

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
      const artwork = svg.querySelector("g[transform]");
      assert.ok(artwork, name);
      assert.ok(artwork.querySelector("path, circle, rect"), name);
      cleanup();
    }
  });

  test("fits every icon's stroked bounds to the edges of its longest viewBox dimension", () => {
    const viewBoxSize = 24;
    const tolerance = 1e-9;

    for (const name of Object.keys(ICONS) as IconName[]) {
      const { container } = render(createElement(Icon, { name }));
      const svg = svgOf(container);
      const artwork = svg.querySelector("g[transform]");
      assert.ok(artwork, name);
      const transform = artwork.getAttribute("transform");
      assert.ok(transform, name);

      const [scale, , , , translateX, translateY] = transform
        .replace(/^matrix\(|\)$/g, "")
        .split(/\s+/)
        .map(Number);

      const definition = ICONS[name];
      const [left, top, right, bottom] = definition.bounds;

      const strokeWidth =
        "strokeWidth" in definition ? definition.strokeWidth : 2;

      const visibleLeft = (left - strokeWidth / 2) * scale + translateX;
      const visibleTop = (top - strokeWidth / 2) * scale + translateY;
      const visibleRight = (right + strokeWidth / 2) * scale + translateX;
      const visibleBottom = (bottom + strokeWidth / 2) * scale + translateY;
      const visibleWidth = visibleRight - visibleLeft;
      const visibleHeight = visibleBottom - visibleTop;

      assert.ok(visibleLeft >= -tolerance, `${name} clips at the left edge`);
      assert.ok(visibleTop >= -tolerance, `${name} clips at the top edge`);

      assert.ok(
        visibleRight <= viewBoxSize + tolerance,
        `${name} clips at the right edge`,
      );

      assert.ok(
        visibleBottom <= viewBoxSize + tolerance,
        `${name} clips at the bottom edge`,
      );

      if (visibleWidth >= visibleHeight) {
        assert.ok(
          Math.abs(visibleLeft) < tolerance,
          `${name} misses left edge`,
        );

        assert.ok(
          Math.abs(visibleRight - viewBoxSize) < tolerance,
          `${name} misses right edge`,
        );
      } else {
        assert.ok(Math.abs(visibleTop) < tolerance, `${name} misses top edge`);

        assert.ok(
          Math.abs(visibleBottom - viewBoxSize) < tolerance,
          `${name} misses bottom edge`,
        );
      }

      cleanup();
    }
  });

  test("keeps the select caret's size on the shared canvas", () => {
    const { container } = render(createElement(Chevron));
    const svg = svgOf(container);

    assert.equal(svg.getAttribute("viewBox"), "0 0 24 24");
    assert.equal(svg.getAttribute("width"), "12");
    assert.equal(svg.getAttribute("height"), "12");
    assert.equal(svg.getAttribute("stroke-width"), "3");

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

  test("size and strokeWidth override the catalog", () => {
    const { container } = render(
      createElement(Icon, { name: "check", size: 10, strokeWidth: 1 }),
    );

    const svg = svgOf(container);
    assert.equal(svg.getAttribute("width"), "10");
    assert.equal(svg.getAttribute("height"), "10");
    assert.equal(svg.getAttribute("stroke-width"), "1");

    assert.ok(
      svg
        .querySelector("g")
        ?.getAttribute("transform")
        ?.startsWith("matrix(1.6 0 0 1.6 "),
    );
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
    assert.equal(svg.querySelector("path"), null);
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
    assert.equal(svg.querySelector("title"), null);
  });
});
