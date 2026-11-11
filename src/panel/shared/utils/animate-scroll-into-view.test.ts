// @vitest-environment jsdom
import assert from "node:assert/strict";

import { afterEach, test, vi } from "vitest";

import { animateScrollIntoView } from "./animate-scroll-into-view";

afterEach(() => document.body.replaceChildren());

function setup(reduceMotion = false) {
  const outer = document.createElement("div");
  const inner = document.createElement("div");
  const target = document.createElement("button");
  const frames = new Map<number, FrameRequestCallback>();

  let nextFrame = 0;

  outer.append(inner);
  inner.append(target);
  document.body.append(outer);
  outer.scrollTop = 20;
  inner.scrollTop = 10;

  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const id = ++nextFrame;

    frames.set(id, callback);

    return id;
  });

  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id);
  });

  vi.spyOn(window.performance, "now").mockReturnValue(100);

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({ matches: reduceMotion })),
  });

  const scrollIntoView = vi.fn(() => {
    outer.scrollTop = 140;
    inner.scrollTop = 250;
  });

  target.scrollIntoView = scrollIntoView;

  function flushFrame(time: number) {
    const pending = [...frames.values()];

    frames.clear();

    for (const callback of pending) callback(time);
  }

  return { outer, inner, target, frames, scrollIntoView, flushFrame };
}

test("animates all scrolling ancestors and finishes after 120ms", () => {
  const { outer, inner, target, frames, scrollIntoView, flushFrame } = setup();

  animateScrollIntoView(target);
  flushFrame(100);

  assert.deepEqual(scrollIntoView.mock.calls[0], [
    { block: "nearest", inline: "nearest", behavior: "instant" },
  ]);

  assert.equal(outer.scrollTop, 20);
  assert.equal(inner.scrollTop, 10);

  flushFrame(160);

  assert.ok(outer.scrollTop > 20 && outer.scrollTop < 140);
  assert.ok(inner.scrollTop > 10 && inner.scrollTop < 250);
  assert.equal(frames.size, 1);

  flushFrame(220);

  assert.equal(outer.scrollTop, 140);
  assert.equal(inner.scrollTop, 250);
  assert.equal(frames.size, 0);
});

test("applies nearest positioning instantly for reduced motion", () => {
  const { outer, inner, target, frames, flushFrame } = setup(true);

  animateScrollIntoView(target);
  flushFrame(100);

  assert.equal(outer.scrollTop, 140);
  assert.equal(inner.scrollTop, 250);
  assert.equal(frames.size, 0);
});

test("cancels before the initial frame without moving the task", () => {
  const { outer, inner, target, frames, scrollIntoView, flushFrame } = setup();
  const cancel = animateScrollIntoView(target);

  cancel();
  flushFrame(100);

  assert.equal(scrollIntoView.mock.calls.length, 0);
  assert.equal(outer.scrollTop, 20);
  assert.equal(inner.scrollTop, 10);
  assert.equal(frames.size, 0);
});
