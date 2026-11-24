// @vitest-environment jsdom
import { expect, test } from "vitest";

import { pngSize, prepareVisualImage } from "./visual-image";

test("an SVG visual draws as a PNG from standalone SVG, without comments", () => {
  const image = prepareVisualImage(
    // XML rejects `--` in a comment, and inline SVG often omits `xmlns`.
    '<svg viewBox="0 0 420 250"><text fill="var(--text)">Signups</text><!-- bars -- Q4 --></svg>',
  );

  expect(image?.size).toEqual({ width: 420, height: 250 });

  const file = new DOMParser().parseFromString(
    image?.svg ?? "",
    "image/svg+xml",
  );

  expect(file.documentElement.namespaceURI).toBe("http://www.w3.org/2000/svg");

  expect(
    [...file.documentElement.childNodes].map(({ nodeName }) => nodeName),
  ).toEqual(["text"]);
});

test("a visual that isn't one SVG element XML accepts has no PNG", () => {
  for (const code of [
    "<style>svg{}</style><svg viewBox='0 0 1 1'></svg>",
    "<svg viewBox='0 0 1 1'></svg><p>Note</p>",
    "Chart <svg viewBox='0 0 1 1'></svg>",
    "<div><svg viewBox='0 0 1 1'></svg></div>",
    '<html><body style="color: red"><svg viewBox="0 0 1 1"></svg></body></html>',
    // Markup HTML accepts and XML doesn't.
    '<svg viewBox="0 0 1 1"><rect 1a="b"/></svg>',
  ]) {
    expect(prepareVisualImage(code), code).toBeUndefined();
  }
});

test("a PNG's size comes only from a usable viewBox or pixel lengths", () => {
  expect(prepareVisualImage('<svg viewBox="0,0 10,5"></svg>')?.size).toEqual({
    width: 10,
    height: 5,
  });

  expect(prepareVisualImage("<svg></svg>")).toBeUndefined();
});

test("a PNG is twice the SVG's size, within the pixel limits", () => {
  expect(pngSize({ width: 420, height: 250 })).toEqual({
    width: 840,
    height: 500,
  });

  for (const size of [
    { width: 10000, height: 10000 },
    { width: 100_000_000, height: 0.01 },
  ]) {
    const { width, height } = pngSize(size);
    expect(width * height).toBeLessThanOrEqual(4096 * 4096);
    expect(Math.max(width, height)).toBeLessThanOrEqual(16384);
  }
});
