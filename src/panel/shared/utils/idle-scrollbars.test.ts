// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";

import { trackIdleScrollbars } from "./idle-scrollbars";

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
  vi.useRealTimers();
});

function setup(overflow = "vertical") {
  vi.useFakeTimers();

  const scroller = document.createElement("div");
  const child = document.createElement("span");

  scroller.style.overflowY = overflow === "vertical" ? "auto" : "hidden";
  scroller.style.overflowX = overflow === "horizontal" ? "scroll" : "hidden";

  Object.defineProperties(scroller, {
    clientHeight: { value: 100 },
    scrollHeight: { value: overflow === "vertical" ? 300 : 100 },
    clientWidth: { value: 100 },
    scrollWidth: { value: overflow === "horizontal" ? 300 : 100 },
  });

  scroller.append(child);
  document.body.append(scroller);
  dispose = trackIdleScrollbars(document);

  return { scroller, child };
}

function pointer(target: HTMLElement, type: string, pointerId = 1) {
  const event = new Event(type, { bubbles: true });

  Object.defineProperty(event, "pointerId", { value: pointerId });
  target.dispatchEvent(event);
}

function expectActive(element: HTMLElement, active: boolean) {
  expect(element.hasAttribute("data-scrollbar-active")).toBe(active);
}

test("repeated scroll activity restarts the idle timer", () => {
  const { scroller } = setup();

  scroller.dispatchEvent(new Event("scroll"));
  vi.advanceTimersByTime(800);
  scroller.dispatchEvent(new Event("scroll"));
  vi.advanceTimersByTime(800);
  expectActive(scroller, true);
  vi.advanceTimersByTime(200);
  expectActive(scroller, false);
  expect(vi.getTimerCount()).toBe(0);
});

test.each(["vertical", "horizontal"])(
  "pointer activity on a descendant reveals its %s scrolling ancestor",
  (overflow) => {
    const { scroller, child } = setup(overflow);

    pointer(child, "pointermove");
    expectActive(scroller, true);
    expectActive(child, false);
    vi.advanceTimersByTime(900);
    pointer(child, "pointermove");
    vi.advanceTimersByTime(900);
    expectActive(scroller, true);
    vi.advanceTimersByTime(100);
    expectActive(scroller, false);
  },
);

test("pointer cancellation ends a held drag and starts its idle timer", () => {
  const { scroller, child } = setup();

  pointer(child, "pointerdown", 4);
  vi.advanceTimersByTime(2000);
  expectActive(scroller, true);

  // Another pointer cannot end the held pointer's interaction.
  pointer(document.body, "pointercancel", 5);
  vi.advanceTimersByTime(1000);
  expectActive(scroller, true);

  pointer(document.body, "pointercancel", 4);
  vi.advanceTimersByTime(999);
  expectActive(scroller, true);
  vi.advanceTimersByTime(1);
  expectActive(scroller, false);
});

test("concurrent pointers keep each scroller visible until its last pointer ends", () => {
  const { scroller: first, child: firstChild } = setup();
  const second = document.createElement("div");
  const secondChild = document.createElement("span");

  second.style.overflowY = "auto";

  Object.defineProperties(second, {
    clientHeight: { value: 100 },
    scrollHeight: { value: 300 },
    clientWidth: { value: 100 },
    scrollWidth: { value: 100 },
  });

  second.append(secondChild);
  document.body.append(second);

  pointer(firstChild, "pointerdown", 1);
  pointer(firstChild, "pointerdown", 2);
  pointer(secondChild, "pointerdown", 3);
  vi.advanceTimersByTime(1000);
  expectActive(first, true);
  expectActive(second, true);

  pointer(document.body, "pointerup", 2);
  vi.advanceTimersByTime(1000);
  expectActive(first, true);
  expectActive(second, true);

  pointer(document.body, "pointerup", 3);
  vi.advanceTimersByTime(1000);
  expectActive(first, true);
  expectActive(second, false);

  pointer(document.body, "pointerup", 1);
  vi.advanceTimersByTime(999);
  expectActive(first, true);
  vi.advanceTimersByTime(1);
  expectActive(first, false);
});

test("cleanup clears markers and pending timers and removes interaction listeners", () => {
  const { scroller, child } = setup();

  scroller.dispatchEvent(new Event("scroll"));
  pointer(child, "pointerdown");
  expectActive(scroller, true);
  expect(vi.getTimerCount()).toBe(1);

  dispose?.();
  dispose = undefined;

  expectActive(scroller, false);
  expect(vi.getTimerCount()).toBe(0);
  scroller.dispatchEvent(new Event("scroll"));

  for (const eventType of [
    "pointermove",
    "pointerdown",
    "pointerup",
    "pointercancel",
  ]) {
    pointer(child, eventType);
  }

  expectActive(scroller, false);
  expect(vi.getTimerCount()).toBe(0);
});
