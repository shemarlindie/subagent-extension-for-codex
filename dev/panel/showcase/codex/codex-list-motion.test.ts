// @vitest-environment jsdom
import { expect, test, vi } from "vitest";

import { codexListEffects } from "./codex-list-motion";

class RecordedEffect {
  constructor(
    readonly target: Element,
    readonly frames: Keyframe[],
    readonly timing: KeyframeEffectOptions,
  ) {}
}

test("a message arriving after the pane opens does not replay the old column position", (t) => {
  vi.stubGlobal("KeyframeEffect", RecordedEffect);

  t.onTestFinished(() => {
    vi.unstubAllGlobals();
  });

  const row = document.createElement("p");
  const before = { top: 300, left: 386, width: 720, height: 24 };
  const after = { ...before, left: 41, top: 270 };

  const resized = codexListEffects(
    row,
    "remain",
    before,
    after,
  ) as unknown as RecordedEffect;

  expect(resized.frames).toEqual([]);
  expect(resized.timing.duration).toBe(0);

  // Later arrivals still move existing rows vertically, using the new column.
  const moved = codexListEffects(row, "remain", after, {
    ...after,
    top: 240,
  }) as unknown as RecordedEffect;

  expect(moved.frames[0]?.transform).toBe("translate(0px, 30px)");
  expect(moved.timing.duration).toBeGreaterThan(0);

  const arrived = codexListEffects(
    row,
    "add",
    after,
  ) as unknown as RecordedEffect;

  expect(arrived.frames[0]?.opacity).toBe(0);
  expect(arrived.timing.duration).toBeGreaterThan(0);
});
