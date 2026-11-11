// @vitest-environment jsdom
import assert from "node:assert/strict";

import { test } from "vitest";

import {
  FILE_ATTRIBUTE,
  measurePosition,
  restorePosition,
} from "./changes-reading";

/** jsdom has no layout, so each element reports a fixed box. */
function box(element: HTMLElement, top: () => number, height: number) {
  element.getBoundingClientRect = () =>
    ({ top: top(), bottom: top() + height }) as DOMRect;
}

// Three 100px files in a scroller whose top edge is at 50px.
function setup() {
  const container = document.createElement("div");
  const viewport = document.createElement("div");

  container.append(viewport);
  box(container, () => 50, 200);

  for (const [index, path] of ["a.ts", "b.ts", "c.ts"].entries()) {
    const file = document.createElement("details");
    file.setAttribute(FILE_ATTRIBUTE, path);
    box(file, () => 50 + index * 100 - container.scrollTop, 100);
    viewport.append(file);
  }

  return { container, viewport };
}

test("the position names the first file still showing at the top", () => {
  const { container, viewport } = setup();
  container.scrollTop = 130;

  const position = measurePosition(viewport, container);

  assert.deepEqual(position, {
    top: 130,
    anchor: { path: "b.ts", top: -30 },
  });
});

test("restoring puts the anchor file back where it was, even if files above it moved", () => {
  const { container, viewport } = setup();

  restorePosition(viewport, container, {
    top: 30,
    anchor: { path: "c.ts", top: -10 },
  });

  // c.ts starts 200px down, so it sits 10px above the top at 210.
  assert.equal(container.scrollTop, 210);
});
