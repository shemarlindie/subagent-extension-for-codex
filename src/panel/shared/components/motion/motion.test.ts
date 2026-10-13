// @vitest-environment jsdom
import assert from "node:assert/strict";

import { expect, test } from "vitest";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  writable: true,
  value: true,
});

import { act, cleanup, render } from "@testing-library/react";
import { createElement, useRef } from "react";

import {
  MotionContent,
  Presence,
  useAnimatedHeight,
  useListPresence,
} from "./motion";

type Call = {
  element: HTMLElement;
  frames: Keyframe[];
  options: KeyframeAnimationOptions;
  animation: { onfinish: (() => void) | null; cancel(): void };
};

// jsdom has no Web Animations API; record calls so tests can finish them by hand.
function mockMotion(t: { onTestFinished(fn: () => void): void }) {
  const calls: Call[] = [];
  let reduced = false;

  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value(
      this: HTMLElement,
      frames: Keyframe[],
      options: KeyframeAnimationOptions,
    ) {
      const animation = {
        onfinish: null,
        playState: "running",
        cancel() {},
      };

      calls.push({ element: this, frames, options, animation });

      return animation;
    },
  });

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: reduced }),
  });

  t.onTestFinished(() => {
    delete (HTMLElement.prototype as any).animate;
    delete (window as any).matchMedia;
  });

  return {
    calls,
    reduce() {
      reduced = true;
    },
  };
}

const notice = (show: boolean, text = "Saved") =>
  createElement(
    Presence,
    { show },
    show && createElement("div", { className: "notice" }, text),
  );

test("MotionContent replaces keyed content with the selected entrance style", (t) => {
  t.onTestFinished(cleanup);

  const content = (value: string, variant: "swap" | "rise" = "swap") =>
    createElement(MotionContent, {
      changeKey: value,
      as: "strong",
      variant,
      className: "activity-title",
      children: value,
    });

  const view = render(content("Thinking"));
  const first = view.container.querySelector("strong");
  assert.ok(first);
  assert.equal(first.className, "motion-swap activity-title");

  view.rerender(content("Thought", "rise"));
  const next = view.container.querySelector("strong");
  assert.ok(next);

  expect(next, "A changed key remounts the presentation element").not.toBe(
    first,
  );

  assert.equal(next.textContent, "Thought");
  assert.equal(next.className, "motion-rise activity-title");
});

test("Presence removes content at once without animation support", (t) => {
  t.onTestFinished(cleanup);
  const view = render(notice(true));
  assert.ok(view.container.querySelector(".notice"));
  view.rerender(notice(false));
  expect(view.container.querySelector(".notice")).toBeNull();
});

test("Presence folds content out, keeping the last content until it finishes", (t) => {
  t.onTestFinished(cleanup);
  const motion = mockMotion(t);
  const view = render(notice(true, "Permission needed"));
  assert.equal(motion.calls.length, 0, "Initial content appears in place");
  view.rerender(notice(false));
  const element = view.container.querySelector<HTMLElement>(".notice");
  assert.ok(element, "Exiting content stays mounted");
  assert.equal(element.textContent, "Permission needed");

  assert.ok(
    element.closest(".presence")?.hasAttribute("inert"),
    "Exiting content cannot be interacted with",
  );

  const exit = motion.calls.at(-1)!;
  expect(exit.element).toBe(element);
  assert.equal(exit.frames[0].opacity, 1);
  assert.equal(exit.frames.at(-1)!.height, "0px");
  assert.equal(exit.frames.at(-1)!.marginTop, "0px");
  assert.equal(exit.options.fill, "forwards");
  act(() => exit.animation.onfinish!());
  expect(view.container.querySelector(".notice")).toBeNull();

  view.rerender(notice(true, "Claude has a question"));
  const entrance = motion.calls.at(-1)!;
  assert.equal(entrance.element.textContent, "Claude has a question");
  assert.equal(entrance.frames[0].height, "0px");
  assert.equal(entrance.frames.at(-1)!.opacity, 1);
});

test("Presence pop variant scales and respects reduced motion", (t) => {
  t.onTestFinished(cleanup);
  const motion = mockMotion(t);

  const button = (show: boolean) =>
    createElement(
      Presence,
      { show, variant: "pop" },
      createElement("button", null, "Latest"),
    );

  const view = render(button(false));
  view.rerender(button(true));
  assert.equal(motion.calls.at(-1)!.frames[0].transform, "scale(0.85)");
  motion.reduce();
  const count = motion.calls.length;
  view.rerender(button(false));
  assert.equal(motion.calls.length, count, "Reduced motion skips the exit");
  expect(view.container.querySelector("button")).toBeNull();
});

function Grow({ open }: { open: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useAnimatedHeight(ref, open);

  return createElement("div", { ref, "data-open": open || undefined });
}

test("useAnimatedHeight eases between the old and new height", (t) => {
  t.onTestFinished(cleanup);
  const motion = mockMotion(t);

  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.dataset.open ? 120 : 40;
    },
  });

  t.onTestFinished(() => {
    delete (HTMLElement.prototype as any).offsetHeight;
  });

  const view = render(createElement(Grow, { open: false }));
  assert.equal(motion.calls.length, 0, "Mounting does not animate");
  view.rerender(createElement(Grow, { open: true }));
  const grow = motion.calls.at(-1)!;
  assert.equal(grow.frames[0].height, "40px");
  assert.equal(grow.frames[1].height, "120px");
  act(() => grow.animation.onfinish!());
  view.rerender(createElement(Grow, { open: false }));
  const shrink = motion.calls.at(-1)!;
  assert.equal(shrink.frames[0].height, "120px");
  assert.equal(shrink.frames[1].height, "40px");
});

test("useListPresence keeps removed items in place and folds new ones in", (t) => {
  t.onTestFinished(cleanup);
  const motion = mockMotion(t);

  function List({ items }: { items: string[] }) {
    const rows = useListPresence(items, (item) => item);

    return createElement(
      "ul",
      null,
      rows.map(({ key, present, added }) =>
        createElement(
          Presence,
          { key, as: "li", show: present, appear: added },
          createElement("div", { "data-row": key }, key),
        ),
      ),
    );
  }

  const order = () =>
    Array.from(
      view.container.querySelectorAll<HTMLElement>("li > [data-row]"),
      (row) => row.dataset.row,
    );

  const view = render(createElement(List, { items: ["a", "b", "c"] }));
  assert.equal(motion.calls.length, 0, "The first list appears in place");

  view.rerender(createElement(List, { items: ["a", "c", "d"] }));
  assert.deepEqual(order(), ["a", "b", "c", "d"], "b exits where it was");

  const [exit, entrance] = motion.calls;
  assert.equal(exit.element.dataset.row, "b");
  assert.equal(exit.frames.at(-1)!.height, "0px");
  assert.equal(entrance.element.dataset.row, "d");
  assert.equal(entrance.frames[0].height, "0px");

  act(() => exit.animation.onfinish!());
  assert.deepEqual(order(), ["a", "c", "d"]);

  // A reorder moves rows without folding any.
  const count = motion.calls.length;
  view.rerender(createElement(List, { items: ["d", "a", "c"] }));
  assert.deepEqual(order(), ["d", "a", "c"]);
  assert.equal(motion.calls.length, count);

  // Items arriving in an empty list are left to whatever shows the list.
  view.rerender(createElement(List, { items: [] }));

  for (const call of motion.calls.slice(count)) {
    act(() => call.animation.onfinish!());
  }

  // The next change drops the finished exits, leaving the list empty.
  view.rerender(createElement(List, { items: [] }));
  const emptied = motion.calls.length;
  view.rerender(createElement(List, { items: ["e"] }));
  assert.deepEqual(order(), ["e"]);
  assert.equal(motion.calls.length, emptied);
});
