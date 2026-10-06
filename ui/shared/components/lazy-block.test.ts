// @vitest-environment jsdom
import assert from "node:assert/strict";

import { test } from "vitest";

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
  const observers: { callback: (entries: Entry[]) => void; root: unknown }[] =
    [];

  class Observer {
    constructor(
      callback: (entries: Entry[]) => void,
      options: { root: unknown },
    ) {
      observers.push({ callback, root: options.root });
    }

    observe() {}
    disconnect() {}
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
  // The scroll area is the observer's root.
  assert.equal(observers[0].root, view.container.firstChild);

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

test("the viewport is the scroll area when no ancestor scrolls", () => {
  const element = document.createElement("div");
  document.body.append(element);
  assert.equal(scrollParent(element), null);
  element.remove();
});
