import { expect, test } from "vitest";

import { visualFileName } from "./visual-export";

const named = (title: string) =>
  visualFileName({ visual: 7, title, code: "" }, "html");

test("a visual's file name is its title as a short ASCII slug, or its number", () => {
  expect(named("  Café — Q3 / 2026! ")).toBe("cafe-q3-2026.html");
  expect(named("日本の売上")).toBe("visual-7.html");
  expect(named(`${"a".repeat(59)} tail`)).toBe(`${"a".repeat(59)}.html`);
});
