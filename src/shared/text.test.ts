import { expect, test } from "vitest";

import { scalarText } from "./text.js";

test("writes strings, numbers and booleans as String does", () => {
  expect(scalarText("hook")).toBe("hook");
  expect(scalarText("")).toBe("");
  expect(scalarText(3)).toBe("3");
  expect(scalarText(false)).toBe("false");
});

test("uses the fallback for missing and structured values", () => {
  expect(scalarText(undefined)).toBe("");
  expect(scalarText(null, "Tool")).toBe("Tool");
  expect(scalarText({ name: "Read" }, "Tool")).toBe("Tool");
  expect(scalarText(["a", "b"], "Tool")).toBe("Tool");
});
