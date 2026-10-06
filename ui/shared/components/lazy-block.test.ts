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
  assert.equal(scrollParent(element), outer);
  assert.equal(scrollParent(outer), null);
  outer.remove();
});
