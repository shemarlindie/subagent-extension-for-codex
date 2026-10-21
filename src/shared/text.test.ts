import { expect, test } from "vitest";

import { scalarText } from "./text.js";

test("uses the fallback for missing and structured values", () => {
  expect(scalarText(undefined)).toBe("");
  expect(scalarText(null, "Tool")).toBe("Tool");
  expect(scalarText({ name: "Read" }, "Tool")).toBe("Tool");
  expect(scalarText(["a", "b"], "Tool")).toBe("Tool");
});
