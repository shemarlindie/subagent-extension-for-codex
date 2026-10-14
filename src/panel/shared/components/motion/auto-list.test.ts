// @vitest-environment jsdom
import { expect, test } from "vitest";

import { autoListEffects } from "./auto-list";
import { MOTION } from "./motion-utils";

type Effect = {
  target: Element;
  frames: Keyframe[];
  timing: KeyframeEffectOptions;
};

// jsdom has no Web Animations API; record each effect the plugin builds.
function mockEffects(
  t: { onTestFinished(fn: () => void): void },
  reduced = false,
) {
  const original = {
    effect: (globalThis as { KeyframeEffect?: unknown }).KeyframeEffect,
    matchMedia: window.matchMedia,
  };

  Object.defineProperty(globalThis, "KeyframeEffect", {
    configurable: true,
    writable: true,
    value: function (
      this: Effect,
      target: Element,
      frames: Keyframe[],
      timing: KeyframeEffectOptions,
    ) {
      Object.assign(this, { target, frames, timing });
    },
  });

  window.matchMedia = ((query: string) => ({
    matches: reduced && query.includes("reduce"),
  })) as typeof window.matchMedia;

  t.onTestFinished(() => {
    Object.defineProperty(globalThis, "KeyframeEffect", {
      configurable: true,
      writable: true,
      value: original.effect,
    });

    window.matchMedia = original.matchMedia;
  });
}

const box = (top: number, height: number, left = 0, width = 200) => ({
  top,
  left,
  width,
  height,
});

const effect = (...args: Parameters<typeof autoListEffects>) =>
  autoListEffects(...args) as unknown as Effect;

test("autoListEffects slides a moved row from its old position", (t) => {
  mockEffects(t);
  const row = document.createElement("li");

  // AutoAnimate passes the old coordinates first for "remain".
  const moved = effect(row, "remain", box(0, 26), box(26, 26));

  expect(moved.frames).toEqual([
    { transform: "translate(0px, -26px)" },
    { transform: "none" },
  ]);

  expect(moved.timing).toEqual({
    duration: MOTION.base,
    easing: MOTION.easing,
  });
});

test("autoListEffects keeps a bottom-anchored list in place and eases its height", (t) => {
  mockEffects(t);
  const list = document.createElement("ul");

  // The list lost a row, so its top moved down while its bottom stayed put.
  const shrunk = effect(list, "remain", box(458, 77), box(484, 51));

  expect(shrunk.frames).toEqual([
    { transform: "translate(0px, 0px)", height: "77px" },
    { transform: "none", height: "51px" },
  ]);
});

test("autoListEffects fades rows in and out with the shared tokens", (t) => {
  mockEffects(t);
  const row = document.createElement("li");
  const added = effect(row, "add", box(0, 26));
  const removed = effect(row, "remove", box(0, 26));

  expect(added.frames[0]).toEqual({
    opacity: 0,
    transform: "translateY(4px)",
  });

  expect(added.timing.duration).toBe(MOTION.base);
  expect(removed.frames).toEqual([{ opacity: 1 }, { opacity: 0 }]);
  expect(removed.timing.duration).toBe(MOTION.fast);
});

test("autoListEffects applies changes at once under reduced motion", (t) => {
  mockEffects(t, true);
  const row = document.createElement("li");

  for (const action of ["add", "remove"] as const) {
    const instant = effect(row, action, box(0, 26));

    expect(instant.frames).toEqual([]);
    expect(instant.timing.duration).toBe(0);
    expect(row.hasAttribute("inert")).toBe(action === "remove");
  }
});

test("exiting controls are inert and reused nodes recover their original state", (t) => {
  mockEffects(t);

  for (const originallyInert of [false, true]) {
    const control = document.createElement("button");

    control.toggleAttribute("inert", originallyInert);
    effect(control, "remove", box(0, 26));
    expect(control.hasAttribute("inert")).toBe(true);

    // A repeated exit must not overwrite the original state.
    effect(control, "remove", box(0, 26));
    effect(control, "add", box(0, 26));
    expect(control.hasAttribute("inert")).toBe(originallyInert);
  }
});
