import { expect, test } from "vitest";

import { frameTimeline } from "./screencast";

test("keeps frame order and valid durations when the timestamps go backward", () => {
  const list = frameTimeline(
    [
      { file: "00000.png", time: 10.02 },
      { file: "00001.png", time: 10.01 },
      { file: "00002.png", time: 10.03 },
    ],
    10.025,
  );

  expect(list.match(/^file .+$/gm)).toEqual([
    "file 00000.png",
    "file 00001.png",
    "file 00002.png",
    "file 00002.png",
  ]);

  expect(list.match(/^duration .+$/gm)).toEqual([
    "duration 0.0000",
    "duration 0.0200",
    "duration 0.0000",
  ]);
});
