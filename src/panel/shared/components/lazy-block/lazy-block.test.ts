// @vitest-environment jsdom
import assert from "node:assert/strict";

import { expect, test } from "vitest";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  writable: true,
  value: true,
});

import { act, cleanup, render } from "@testing-library/react";
import { createElement } from "react";

import { LazyBlock, scrollParent } from "./lazy-block";

type Entry = {
  isIntersecting: boolean;
  boundingClientRect: { height: number };
};

// jsdom has no IntersectionObserver; keep each callback so tests can report
// the block entering and leaving view by hand.
function mockObserver(t: { onTestFinished(fn: () => void): void }) {
  const observers: {
    callback: (entries: Entry[]) => void;
    root: unknown;
    disconnected: boolean;
  }[] = [];

  class Observer {
    private record;
    constructor(
      callback: (entries: Entry[]) => void,
      options: { root: unknown },
    ) {
      this.record = { callback, root: options.root, disconnected: false };
      observers.push(this.record);
    }

    observe() {}
    disconnect() {
      this.record.disconnected = true;
    }
  }

  Object.defineProperty(globalThis, "IntersectionObserver", {
    configurable: true,
    value: Observer,
  });

  t.onTestFinished(() => {
    cleanup();

    delete (globalThis as { IntersectionObserver?: unknown })
      .IntersectionObserver;
  });

  return observers;
}

test("a block mounts its rows in view and keeps its measured height out of view", (t) => {
  const observers = mockObserver(t);

  const view = render(
    createElement(
      "div",
      { style: { overflowY: "auto" } },
      createElement(LazyBlock, { estimate: 40, children: "rows" }),
    ),
  );

  const block = view.container.firstChild!.firstChild as HTMLElement;
  assert.equal(block.textContent, "");
  assert.equal(block.style.height, "40px");

  act(() =>
    observers[0].callback([
      { isIntersecting: true, boundingClientRect: { height: 40 } },
    ]),
  );

  assert.equal(block.textContent, "rows");
  assert.equal(block.style.height, "");

  act(() =>
    observers[0].callback([
      { isIntersecting: false, boundingClientRect: { height: 75 } },
    ]),
  );

  assert.equal(block.textContent, "");
  assert.equal(block.style.height, "75px");
});

test("without IntersectionObserver, blocks always render", (t) => {
  t.onTestFinished(cleanup);

  const view = render(
    createElement(LazyBlock, { estimate: 40, children: "rows" }),
  );

  assert.equal(view.container.textContent, "rows");
});

test("the scroll area is the nearest ancestor that overflows, else the viewport", () => {
  // jsdom lays nothing out, so sizes are set by hand.
  const box = (overflowing: boolean) => {
    const element = document.createElement("div");
    element.style.overflowY = "auto";
    Object.defineProperty(element, "scrollHeight", { value: 500 });

    Object.defineProperty(element, "clientHeight", {
      value: overflowing ? 100 : 500,
    });

    return element;
  };

  const outer = box(true),
    // Scrolls sideways only: grown to fit its rows, as a table view is.
    inner = box(false),
    element = document.createElement("div");

  inner.append(element);
  outer.append(inner);
  document.body.append(outer);
  expect(scrollParent(element)).toBe(outer);
  expect(scrollParent(outer)).toBeNull();
  outer.remove();
});

test("after a resize changes which box scrolls, blocks watch the new one", (t) => {
  const observers = mockObserver(t);
  // Run resize callbacks at once instead of on the next frame.
  const frame = window.requestAnimationFrame;

  window.requestAnimationFrame = (callback) => {
    callback(0);

    return 0;
  };

  t.onTestFinished(() => {
    window.requestAnimationFrame = frame;
  });

  // jsdom lays nothing out, so which box overflows is set by hand.
  const box = () => {
    const element = document.createElement("div");
    element.style.overflowY = "auto";
    let overflowing = false;
    Object.defineProperty(element, "scrollHeight", { get: () => 500 });

    Object.defineProperty(element, "clientHeight", {
      get: () => (overflowing ? 100 : 500),
    });

    return { element, overflow: (value: boolean) => (overflowing = value) };
  };

  const outer = box(),
    inner = box();

  outer.element.append(inner.element);
  document.body.append(outer.element);
  t.onTestFinished(() => outer.element.remove());
  inner.overflow(true);

  render(createElement(LazyBlock, { estimate: 40, children: "rows" }), {
    container: inner.element,
  });

  expect(observers.at(-1)?.root).toBe(inner.element);

  // A resize that leaves the same box scrolling keeps the observer.
  window.dispatchEvent(new Event("resize"));
  assert.equal(observers.length, 1);

  // A narrower frame: now the outer box scrolls and the inner one fits.
  inner.overflow(false);
  outer.overflow(true);
  window.dispatchEvent(new Event("resize"));
  assert.equal(observers.length, 2);
  assert.equal(observers[0].disconnected, true);
  expect(observers[1].root).toBe(outer.element);
});

test("a scroll area changing size, without a window resize, also re-finds it", (t) => {
  const observers = mockObserver(t);
  const frame = window.requestAnimationFrame;

  window.requestAnimationFrame = (callback) => {
    callback(0);

    return 0;
  };

  // jsdom has no ResizeObserver; record what is watched and report by hand.
  const watched = new Set<Element>();
  let report = () => {};

  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class {
      constructor(callback: () => void) {
        report = callback;
      }

      observe(element: Element) {
        watched.add(element);
      }

      unobserve(element: Element) {
        watched.delete(element);
      }
    },
  });

  t.onTestFinished(() => {
    window.requestAnimationFrame = frame;
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  });

  const box = () => {
    const element = document.createElement("div");
    element.style.overflowY = "auto";
    let overflowing = false;
    Object.defineProperty(element, "scrollHeight", { get: () => 500 });

    Object.defineProperty(element, "clientHeight", {
      get: () => (overflowing ? 100 : 500),
    });

    return { element, overflow: (value: boolean) => (overflowing = value) };
  };

  const outer = box(),
    inner = box();

  outer.element.append(inner.element);
  document.body.append(outer.element);
  t.onTestFinished(() => outer.element.remove());
  inner.overflow(true);

  const view = render(
    createElement(LazyBlock, { estimate: 40, children: "rows" }),
    { container: inner.element },
  );

  // Identity, not deep equality: deep-comparing jsdom nodes walks the document.
  assert.equal(watched.size, 1);
  assert.ok(watched.has(inner.element));

  // A taller header leaves the inner box without room, and the outer one
  // scrolls instead; only the inner box's size changed.
  inner.overflow(false);
  outer.overflow(true);
  report();
  expect(observers.at(-1)?.root).toBe(outer.element);
  assert.equal(watched.size, 1);
  assert.ok(watched.has(outer.element));

  view.unmount();
  assert.equal(watched.size, 0);
});
