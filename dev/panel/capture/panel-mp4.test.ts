import { expect, test } from "vitest";

import { fitCanvas } from "./panel-mp4";

test("contain scales thin crops to a positive size inside the canvas", () => {
  const crop = { x: 0, y: 0, width: 640, height: 2 };

  expect(fitCanvas(crop, { width: 32, height: 32 })).toEqual({
    crop,
    scaled: { width: 32, height: 2 },
  });
});

test("cover trims the center of the source before upscaling", () => {
  expect(
    fitCanvas(
      { x: 10, y: 20, width: 2, height: 640 },
      { width: 1920, height: 1080, fit: "cover" },
    ),
  ).toEqual({
    crop: { x: 10, y: 339, width: 2, height: 2 },
    scaled: { width: 1920, height: 1080 },
  });
});
