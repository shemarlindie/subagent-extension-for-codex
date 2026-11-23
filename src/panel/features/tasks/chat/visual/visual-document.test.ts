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
  // The frame script reports heights, which only Chat's frame needs.
  expect(visualDocument("", theme)).toContain("visual-height");
  expect(saved).not.toContain("visual-height");
});
