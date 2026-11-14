// @vitest-environment jsdom
import assert from "node:assert/strict";

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { ReadingState } from "./reading-state";
import { useReadingScroll } from "./use-reading-scroll";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  writable: true,
  value: true,
});

interface ChatProps {
  reading: ReadingState;
  items: string[];
  active?: boolean;
  ready?: boolean;
  stacked?: boolean;
  follow?: boolean;
}

function Chat({
  reading,
  items,
  active = true,
  ready = true,
  stacked = false,
  follow = false,
}: ChatProps) {
  const { viewportRef, pinned, scrollToLatest } = useReadingScroll({
    reading,
    active,
    ready,
    itemAttribute: "data-chat-item",
    followSmoothly: follow,
  });

  const timeline = createElement(
    "div",
    {
      ref: viewportRef,
      "data-testid": "chat",
      role: "region",
      "aria-label": "Chat history",
      tabIndex: 0,
      style: { overflowY: stacked ? "visible" : "auto" },
    },
    items.map((id) =>
      createElement("div", { key: id, "data-chat-item": id }, id),
    ),
  );

  const button =
    ready && !pinned
      ? createElement(
          "button",
          { type: "button", onClick: scrollToLatest },
          "Scroll to latest message",
        )
      : undefined;

  return stacked
    ? createElement(
        "div",
        { "data-testid": "inspector", style: { overflowY: "auto" } },
        timeline,
        button,
      )
    : createElement("div", null, timeline, button);
}

let viewportHeight = 200;
let notifyResize: (() => void) | undefined;

/** Reports a resize to the chat's resize observer. */
function resize() {
  assert.ok(notifyResize, "The chat observes resizes");
  notifyResize();
}

beforeEach(() => {
  viewportHeight = 200;
  notifyResize = undefined;

  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        notifyResize = () => callback([], this as unknown as ResizeObserver);
      }

      observe() {}

      disconnect() {}
    },
  );

  const tops = new WeakMap<HTMLElement, number>();

  vi.spyOn(HTMLElement.prototype, "scrollTop", "get").mockImplementation(
    function (this: HTMLElement) {
      return tops.get(this) ?? 0;
    },
  );

  vi.spyOn(HTMLElement.prototype, "scrollTop", "set").mockImplementation(
    function (this: HTMLElement, value: number) {
      tops.set(
        this,
        Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight)),
      );
    },
  );

  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.querySelectorAll("[data-chat-item]").length * 100;
    },
  );

  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
    () => viewportHeight,
  );

  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      let top = 100;
      let height = viewportHeight;

      const viewport = this.parentElement;

      if (viewport && this.hasAttribute("data-chat-item")) {
        const container =
          viewport.parentElement?.dataset.testid === "inspector"
            ? viewport.parentElement
            : viewport;

        top += [...viewport.children].indexOf(this) * 100 - container.scrollTop;
        height = 100;
      }

      return {
        top,
        bottom: top + height,
        left: 0,
        right: 400,
        width: 400,
        height,
        x: 0,
        y: top,
        toJSON: () => ({}),
      };
    },
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const items = ["a", "b", "c", "d", "e", "f"];

test("chat remains pinned throughout composer expansion and collapse", () => {
  const reading: ReadingState = {};
  const view = render(createElement(Chat, { reading, items }));
  const viewport = view.getByTestId("chat");

  for (const height of [180, 140, 100, 140, 180, 200]) {
    act(() => {
      viewportHeight = height;
      resize();
    });

    assert.equal(viewport.scrollTop, viewport.scrollHeight - height);
    assert.equal(reading.position?.pinned, true);
    fireEvent.scroll(viewport);
  }
});

test("composer resizing preserves the unpinned reader's visible message", () => {
  const reading: ReadingState = {};
  const view = render(createElement(Chat, { reading, items }));
  const viewport = view.getByTestId("chat");
  viewport.scrollTop = 125;
  fireEvent.scroll(viewport);

  for (const height of [180, 140, 100, 140, 180, 200]) {
    act(() => {
      viewportHeight = height;
      resize();
    });

    assert.equal(viewport.scrollTop, 125);
    assert.deepEqual(reading.position?.anchor, { id: "b", top: -25 });
    assert.equal(reading.position?.pinned, false);
    fireEvent.scroll(viewport);
  }
});

test("chat restores the visible message after remount with earlier history inserted", () => {
  const reading: ReadingState = {};
  const view = render(createElement(Chat, { reading, items }));
  const viewport = view.getByTestId("chat");
  viewport.scrollTop = 125;
  fireEvent.scroll(viewport);
  view.unmount();

  const restored = render(
    createElement(Chat, { reading, items: ["earlier", ...items, "new reply"] }),
  );

  assert.equal(restored.getByTestId("chat").scrollTop, 225);
  assert.deepEqual(reading.position?.anchor, { id: "b", top: -25 });
  assert.equal(reading.position?.pinned, false);
});

test("updates respect a reader scroll before the browser delivers its scroll event", () => {
  const reading: ReadingState = {};
  const view = render(createElement(Chat, { reading, items }));
  const viewport = view.getByTestId("chat");
  viewport.scrollTop = 125;
  fireEvent.scroll(viewport);
  viewport.scrollTop = 175;

  view.rerender(createElement(Chat, { reading, items: ["earlier", ...items] }));

  assert.equal(viewport.scrollTop, 275);
  assert.deepEqual(reading.position?.anchor, { id: "b", top: -75 });
});

test("a pinned reader who scrolls away before its event stops following updates", () => {
  const reading: ReadingState = {};
  const view = render(createElement(Chat, { reading, items }));
  const viewport = view.getByTestId("chat");
  assert.equal(viewport.scrollTop, 400);
  viewport.scrollTop = 250;

  view.rerender(createElement(Chat, { reading, items: [...items, "g"] }));

  assert.equal(viewport.scrollTop, 250);
  assert.ok(view.getByRole("button", { name: "Scroll to latest message" }));
});

test("a pinned view stays pinned when a shrinking row clamps its scroll position", () => {
  const reading: ReadingState = {};
  const view = render(createElement(Chat, { reading, items }));
  const viewport = view.getByTestId("chat");

  // Measuring a shrunk row clamps the scroll position before its height
  // animation holds the old height again.
  Object.defineProperty(viewport, "getAnimations", {
    value: () => [
      {
        effect: {
          getKeyframes: () => [{ height: "300px" }, { height: "100px" }],
        },
      },
    ],
  });

  viewport.scrollTop = 250;
  view.rerender(createElement(Chat, { reading, items: [...items, "g"] }));

  assert.equal(viewport.scrollTop, 500);
  fireEvent.scroll(viewport);

  expect(
    view.queryByRole("button", { name: "Scroll to latest message" }),
  ).toBeNull();
});

test("a reader scroll to the end before its event repins once the event arrives", () => {
  const reading: ReadingState = {};
  const view = render(createElement(Chat, { reading, items }));
  const viewport = view.getByTestId("chat");
  viewport.scrollTop = 125;
  fireEvent.scroll(viewport);
  viewport.scrollTop = 400;

  view.rerender(createElement(Chat, { reading, items: ["earlier", ...items] }));

  assert.equal(viewport.scrollTop, 500);
  fireEvent.scroll(viewport);
  assert.equal(reading.position?.pinned, true);
});

test("a dropped anchor falls back to the next row that was visible", () => {
  const reading: ReadingState = {};
  const view = render(createElement(Chat, { reading, items }));
  const viewport = view.getByTestId("chat");
  viewport.scrollTop = 125;
  fireEvent.scroll(viewport);
  assert.deepEqual(reading.position?.anchor, { id: "b", top: -25 });

  view.rerender(
    createElement(Chat, {
      reading,
      items: items.filter((id) => id !== "b"),
    }),
  );

  // "c" stays 75px below the top, where it was before "b" was removed.
  assert.equal(viewport.scrollTop, 25);
  assert.equal(reading.position?.pinned, false);
});

test("a row that opts out of scroll anchoring never holds the reader's place", () => {
  // "b" stands in for a marker, such as Chat's New divider, that moves.
  const computed = window.getComputedStyle.bind(window);

  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
    const style = computed(element);
    if (element.getAttribute("data-chat-item") !== "b") return style;

    return { ...style, overflowY: style.overflowY, overflowAnchor: "none" };
  });

  const reading: ReadingState = {};
  const view = render(createElement(Chat, { reading, items }));
  const viewport = view.getByTestId("chat");
  viewport.scrollTop = 125;
  fireEvent.scroll(viewport);
  assert.deepEqual(reading.position?.anchor, { id: "c", top: 75 });

  view.rerender(
    createElement(Chat, {
      reading,
      items: [...items.filter((id) => id !== "b"), "b"],
    }),
  );

  // "c" stays 75px below the top, rather than following "b" to the end.
  assert.equal(viewport.scrollTop, 25);
});

test("chat follows new replies and remounted updates only while pinned", () => {
  const reading: ReadingState = {};
  const view = render(createElement(Chat, { reading, items }));
  const viewport = view.getByTestId("chat");
  assert.equal(viewport.scrollTop, 400);
  view.rerender(createElement(Chat, { reading, items: [...items, "g"] }));
  assert.equal(viewport.scrollTop, 500);
  viewport.scrollTop = 100;
  fireEvent.scroll(viewport);
  view.rerender(createElement(Chat, { reading, items: [...items, "g", "h"] }));
  assert.equal(viewport.scrollTop, 100);
  viewport.scrollTop = 600;
  fireEvent.scroll(viewport);
  view.unmount();

  const restored = render(
    createElement(Chat, { reading, items: [...items, "g", "h", "i"] }),
  );

  assert.equal(restored.getByTestId("chat").scrollTop, 700);
});

test("scroll to latest returns to the end, restores focus and follows later replies", () => {
  const reading: ReadingState = {};
  const view = render(createElement(Chat, { reading, items }));
  const viewport = view.getByRole("region", { name: "Chat history" });

  const button = () =>
    view.queryByRole("button", { name: "Scroll to latest message" });

  assert.equal(viewport.scrollTop, 400);
  expect(button()).toBeNull();
  viewport.scrollTop = 151;
  fireEvent.scroll(viewport);

  fireEvent.click(
    view.getByRole("button", { name: "Scroll to latest message" }),
  );

  assert.equal(viewport.scrollTop, 400);
  expect(button()).toBeNull();
  expect(document.activeElement).toBe(viewport);

  assert.deepEqual(reading.position, {
    top: 400,
    pinned: true,
    anchor: { id: "e", top: 0 },
  });

  view.rerender(createElement(Chat, { reading, items: [...items, "g"] }));
  assert.equal(viewport.scrollTop, 500);
});

test("scroll to latest uses the shared inspector scroller", () => {
  const reading: ReadingState = {};
  const view = render(createElement(Chat, { reading, items, stacked: true }));
  const viewport = view.getByRole("region", { name: "Chat history" });
  const inspector = view.getByTestId("inspector");
  inspector.scrollTop = 125;
  fireEvent.scroll(inspector);

  fireEvent.click(
    view.getByRole("button", { name: "Scroll to latest message" }),
  );

  assert.equal(inspector.scrollTop, 400);
  assert.equal(viewport.scrollTop, 0);
  expect(document.activeElement).toBe(viewport);

  view.rerender(
    createElement(Chat, { reading, items: [...items, "g"], stacked: true }),
  );

  assert.equal(inspector.scrollTop, 500);
});

/** Runs animation frames on fake timers. `advance` plays `ms` of them. */
function useFrames(t: { onTestFinished(fn: () => void): void }) {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "performance",
    ],
  });

  t.onTestFinished(() => {
    vi.useRealTimers();
  });

  return (ms: number) =>
    act(() => {
      vi.advanceTimersByTime(ms);
    });
}

/** Lets the hook glide, which it does only where smooth scrolling exists. */
function allowGlides(viewport: HTMLElement) {
  Object.defineProperty(viewport, "scrollTo", {
    configurable: true,
    value: vi.fn(),
  });
}

test("a smooth return stays pinned until the reader takes over", (t) => {
  const advance = useFrames(t);
  const reading: ReadingState = {};
  const view = render(createElement(Chat, { reading, items }));
  const viewport = view.getByTestId("chat");
  allowGlides(viewport);

  const button = () =>
    view.queryByRole("button", { name: "Scroll to latest message" });

  const scrollAt = (top: number) => {
    viewport.scrollTop = top;
    fireEvent.scroll(viewport);
  };

  scrollAt(100);

  fireEvent.click(
    view.getByRole("button", { name: "Scroll to latest message" }),
  );

  advance(100);
  const gliding = viewport.scrollTop;
  assert.ok(gliding > 100 && gliding < 400, "The return glides");
  fireEvent.scroll(viewport);
  expect(button()).toBeNull();

  scrollAt(gliding - 10);
  assert.ok(button(), "Moving away hands control back to the reader");
  advance(100);
  assert.equal(viewport.scrollTop, gliding - 10);
});

test("new content finishes a smooth return at the live edge", (t) => {
  useFrames(t);
  const reading: ReadingState = {};
  const view = render(createElement(Chat, { reading, items }));
  const viewport = view.getByTestId("chat");
  allowGlides(viewport);
  viewport.scrollTop = 100;
  fireEvent.scroll(viewport);

  fireEvent.click(
    view.getByRole("button", { name: "Scroll to latest message" }),
  );

  view.rerender(createElement(Chat, { reading, items: [...items, "g"] }));
  assert.equal(viewport.scrollTop, 500);

  expect(
    view.queryByRole("button", { name: "Scroll to latest message" }),
  ).toBeNull();
});

test("following smoothly glides to new replies and keeps its speed through a retarget", (t) => {
  const advance = useFrames(t);
  const reading: ReadingState = {};
  const props = { reading, follow: true };
  const view = render(createElement(Chat, { ...props, items }));
  const viewport = view.getByTestId("chat");
  allowGlides(viewport);

  assert.equal(viewport.scrollTop, 400, "The first layout jumps");
  view.rerender(createElement(Chat, { ...props, items: [...items, "g"] }));
  assert.equal(viewport.scrollTop, 400, "Following glides");
  advance(100);
  const previous = viewport.scrollTop;
  advance(16);
  const before = viewport.scrollTop;
  assert.ok(before > 400 && before < 500);

  const more = [...items, "g", "h"];
  view.rerender(createElement(Chat, { ...props, items: more }));
  advance(16);

  assert.ok(
    viewport.scrollTop - before >= before - previous,
    "A retarget keeps the glide's speed",
  );

  advance(1000);
  assert.equal(viewport.scrollTop, 600);
  fireEvent.scroll(viewport);

  expect(
    view.queryByRole("button", { name: "Scroll to latest message" }),
  ).toBeNull();

  view.rerender(createElement(Chat, { ...props, items: [...more, "i"] }));
  advance(16);

  view.rerender(
    createElement(Chat, { ...props, items: [...more, "i"], active: false }),
  );

  const hidden = viewport.scrollTop;
  advance(1000);
  assert.equal(viewport.scrollTop, hidden, "A hidden view stops gliding");

  view.rerender(
    createElement(Chat, { ...props, items: [...more, "i", "j"], active: true }),
  );

  assert.equal(viewport.scrollTop, 800, "A revealed view jumps to its end");
});

test("a reader scroll toward the end during a glide keeps their position", (t) => {
  const advance = useFrames(t);
  const reading: ReadingState = {};
  const props = { reading, follow: true };
  const view = render(createElement(Chat, { ...props, items }));
  const viewport = view.getByTestId("chat");
  allowGlides(viewport);
  const more = [...items, "g", "h", "i"];
  view.rerender(createElement(Chat, { ...props, items: more }));
  advance(50);
  assert.ok(viewport.scrollTop < 600);

  viewport.scrollTop = 650;
  fireEvent.scroll(viewport);
  advance(16);
  assert.ok(viewport.scrollTop >= 650, "The glide continues from the reader");
  advance(1000);
  assert.equal(viewport.scrollTop, 700);

  expect(
    view.queryByRole("button", { name: "Scroll to latest message" }),
  ).toBeNull();
});

test("a shrinking row's clamp during a glide keeps following", (t) => {
  const advance = useFrames(t);
  const reading: ReadingState = {};
  const props = { reading, follow: true };
  const view = render(createElement(Chat, { ...props, items }));
  const viewport = view.getByTestId("chat");
  allowGlides(viewport);
  view.rerender(createElement(Chat, { ...props, items: [...items, "g"] }));
  advance(100);
  const gliding = viewport.scrollTop;

  Object.defineProperty(viewport, "getAnimations", {
    configurable: true,
    value: () => [
      {
        effect: {
          getKeyframes: () => [{ height: "300px" }, { height: "100px" }],
        },
      },
    ],
  });

  viewport.scrollTop = 0;
  fireEvent.scroll(viewport);
  advance(16);
  assert.ok(viewport.scrollTop > gliding, "The glide undoes the clamp");
  advance(1000);
  assert.equal(viewport.scrollTop, 500);

  expect(
    view.queryByRole("button", { name: "Scroll to latest message" }),
  ).toBeNull();
});

test.for(["wheel", "touch", "keyboard"] as const)(
  "%s reading intent releases following before a content resize",
  (gesture, t) => {
    const advance = useFrames(t);
    const reading: ReadingState = {};
    const props = { reading, follow: true };
    const view = render(createElement(Chat, { ...props, items }));
    const viewport = view.getByTestId("chat");
    allowGlides(viewport);
    view.rerender(createElement(Chat, { ...props, items: [...items, "g"] }));

    const button = () =>
      view.queryByRole("button", { name: "Scroll to latest message" });

    if (gesture === "wheel") {
      fireEvent.wheel(viewport, { deltaY: -100, ctrlKey: true });
      expect(button()).toBeNull();
      fireEvent.wheel(viewport, { deltaY: -100 });
    } else if (gesture === "touch") {
      fireEvent.touchStart(viewport, { touches: [{ clientY: 100 }] });
      fireEvent.touchMove(viewport, { touches: [{ clientY: 200 }] });
    } else {
      fireEvent.keyDown(viewport, { key: "ArrowUp" });
    }

    expect(button()).not.toBeNull();
    act(() => resize());
    advance(1000);
    expect(viewport.scrollTop).toBe(400);

    viewport.scrollTop = 300;
    fireEvent.scroll(viewport);

    view.rerender(
      createElement(Chat, { ...props, items: [...items, "g", "h"] }),
    );

    expect(viewport.scrollTop).toBe(300);
    expect(button()).not.toBeNull();
  },
);

test("an upward scroll still near the end does not resume following", (t) => {
  const advance = useFrames(t);
  const reading: ReadingState = {};
  const props = { reading, follow: true };
  const view = render(createElement(Chat, { ...props, items }));
  const viewport = view.getByTestId("chat");
  allowGlides(viewport);

  const button = () =>
    view.queryByRole("button", { name: "Scroll to latest message" });

  // An animated wheel scroll reports its first frames close to the end.
  fireEvent.wheel(viewport, { deltaY: -100 });
  // An update can render between a frame and its scroll event.
  viewport.scrollTop = 370;
  view.rerender(createElement(Chat, { ...props, items }));
  fireEvent.scroll(viewport);
  expect(button()).not.toBeNull();

  const more = [...items, "g"];
  view.rerender(createElement(Chat, { ...props, items: more }));
  advance(1000);
  expect(viewport.scrollTop).toBe(370);
});

test("reduced motion returns to latest without a smooth glide", () => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: true })),
  );

  const reading: ReadingState = {};
  const view = render(createElement(Chat, { reading, items }));
  const viewport = view.getByTestId("chat");
  const scrollTo = vi.fn();

  Object.defineProperty(viewport, "scrollTo", {
    configurable: true,
    value: scrollTo,
  });

  viewport.scrollTop = 100;
  fireEvent.scroll(viewport);

  fireEvent.click(
    view.getByRole("button", { name: "Scroll to latest message" }),
  );

  assert.equal(scrollTo.mock.calls.length, 0);
  assert.equal(viewport.scrollTop, 400);
  expect(document.activeElement).toBe(viewport);
});

test("hidden chat updates preserve its anchor until revealed", () => {
  const reading: ReadingState = {};
  const view = render(createElement(Chat, { reading, items }));
  const viewport = view.getByTestId("chat");
  viewport.scrollTop = 125;
  fireEvent.scroll(viewport);
  const saved = reading.position;

  view.rerender(
    createElement(Chat, {
      reading,
      items: ["earlier", ...items],
      active: false,
    }),
  );

  viewport.scrollTop = 0;
  fireEvent.scroll(viewport);
  assert.equal(reading.position, saved);

  view.rerender(
    createElement(Chat, {
      reading,
      items: ["earlier", ...items],
      active: true,
    }),
  );

  assert.equal(viewport.scrollTop, 225);
});

test("a pinned hidden chat returns to latest after another tab moves the shared scroller", () => {
  const reading: ReadingState = {};
  const view = render(createElement(Chat, { reading, items, stacked: true }));
  const inspector = view.getByTestId("inspector");
  assert.equal(inspector.scrollTop, 400);

  view.rerender(
    createElement(Chat, { reading, items, stacked: true, active: false }),
  );

  inspector.scrollTop = 125;
  fireEvent.scroll(inspector);

  view.rerender(
    createElement(Chat, {
      reading,
      items: [...items, "g"],
      stacked: true,
      active: false,
    }),
  );

  view.rerender(
    createElement(Chat, {
      reading,
      items: [...items, "g"],
      stacked: true,
      active: true,
    }),
  );

  assert.equal(inspector.scrollTop, 500);
  assert.equal(reading.position?.pinned, true);

  expect(
    view.queryByRole("button", { name: "Scroll to latest message" }),
  ).toBeNull();
});

test("chat waits for loaded history before restoring a saved position", () => {
  const reading: ReadingState = {
    position: { top: 125, pinned: false, anchor: { id: "b", top: -25 } },
  };

  const view = render(
    createElement(Chat, { reading, items: [], ready: false }),
  );

  assert.equal(reading.position?.top, 125);

  expect(
    view.queryByRole("button", { name: "Scroll to latest message" }),
  ).toBeNull();

  view.rerender(createElement(Chat, { reading, items, ready: true }));
  assert.equal(view.getByTestId("chat").scrollTop, 125);
  assert.ok(view.getByRole("button", { name: "Scroll to latest message" }));
});

test("stacked chat restores its anchor through the inspector's shared scroller", () => {
  const reading: ReadingState = {};
  const view = render(createElement(Chat, { reading, items, stacked: true }));
  const inspector = view.getByTestId("inspector");

  assert.equal(inspector.scrollTop, 400);
  assert.equal(view.getByTestId("chat").scrollTop, 0);
  inspector.scrollTop = 125;
  fireEvent.scroll(inspector);
  assert.equal(reading.position?.pinned, false);

  view.rerender(
    createElement(Chat, {
      reading,
      items: ["earlier", ...items],
      stacked: true,
    }),
  );

  assert.equal(inspector.scrollTop, 225);
  assert.deepEqual(reading.position?.anchor, { id: "b", top: -25 });
  view.unmount();

  const restored = render(
    createElement(Chat, {
      reading,
      items: ["earlier", ...items],
      stacked: true,
    }),
  );

  assert.equal(restored.getByTestId("inspector").scrollTop, 225);
});
