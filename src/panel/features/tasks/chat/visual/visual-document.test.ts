// @vitest-environment jsdom
import { expect, test } from "vitest";

import { savedVisualDocument, visualDocument } from "./visual-document";

test("a saved visual keeps its code, theme, background and policy, and leaves out the frame script", () => {
  const theme = ":root { --background: navy; }";
  const saved = savedVisualDocument("A & <b>", "<svg>chart</svg>", theme);

  expect(saved).toContain("<title>A &amp; &lt;b></title>");
  expect(saved).toContain("<svg>chart</svg>");
  expect(saved).toContain(theme);
  expect(saved).toContain("background: var(--background)");
  expect(saved).toContain('http-equiv="Content-Security-Policy"');
  // The frame script reports sizes, which only Chat's frame needs.
  expect(visualDocument("", theme)).toContain("visual-size");
  expect(saved).not.toContain("visual-size");
});

test("a top-level SVG without a pixel width stops at a viewBox width below the cap", () => {
  const stops = (code: string) =>
    [...visualDocument(code, "").matchAll(/min\(100%, (\d+)px\)/g)]
      .map((match) => Number(match[1]))
      .filter((width) => width !== 720);

  expect(stops('<svg viewBox="0 0 420 250" width="100%"></svg>')).toEqual([
    420,
  ]);

  expect(stops('<svg viewBox="0 0 900 300"></svg>')).toEqual([]);
  expect(stops('<div><svg viewBox="0 0 420 250"></svg></div>')).toEqual([]);
});
