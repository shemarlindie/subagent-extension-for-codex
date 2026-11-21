import { expect, test } from "vitest";

import { cropWithinViewport, rectangleBounds } from "./capture-bounds";

test("clips a rectangle to the viewport and aligns it for MP4", () => {
  const bounds = rectangleBounds({ x: -3, y: 19, width: 108, height: 99 });

  expect(cropWithinViewport(bounds, { width: 101, height: 81 })).toEqual({
    x: 0,
    y: 18,
    width: 100,
    height: 62,
  });
});

test("rejects a rectangle with no encodable area inside the viewport", () => {
  const bounds = rectangleBounds({ x: 20, y: 20, width: 10, height: 10 });

  expect(() => cropWithinViewport(bounds, { width: 20, height: 20 })).toThrow(
    "at least two pixels",
  );
});
