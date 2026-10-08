// @vitest-environment jsdom
import assert from "node:assert/strict";

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, test, vi } from "vitest";

import type { ReadingState } from "../evidence/reading-state";
import { useChatScroll } from "./use-chat-scroll";

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
}

function Chat({
  reading,
  items,
  active = true,
  ready = true,
  stacked = false,
}: ChatProps) {
  const ref = useChatScroll(reading, active, ready);

  const timeline = createElement(
    "div",
    {
      ref,
      "data-testid": "chat",
      style: { overflowY: stacked ? "visible" : "auto" },
    },
    items.map((id) =>
      createElement("div", { key: id, "data-chat-item": id }, id),
    ),
  );

  return stacked
    ? createElement(
        "div",
        { "data-testid": "inspector", style: { overflowY: "auto" } },
        timeline,
      )
    : timeline;
}

let viewportHeight = 200;
let notifyResize: (() => void) | undefined;

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

      if (this.hasAttribute("data-chat-item")) {
        const viewport = this.parentElement!;

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

  assert.ok(notifyResize);

  for (const height of [180, 140, 100, 140, 180, 200]) {
    act(() => {
      viewportHeight = height;
      notifyResize!();
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

  assert.ok(notifyResize);

  for (const height of [180, 140, 100, 140, 180, 200]) {
    act(() => {
      viewportHeight = height;
      notifyResize!();
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

test("active chat updates retain the visible message when earlier history arrives", () => {
  const reading: ReadingState = {};
  const view = render(createElement(Chat, { reading, items }));
  const viewport = view.getByTestId("chat");
  viewport.scrollTop = 125;
  fireEvent.scroll(viewport);

  view.rerender(createElement(Chat, { reading, items: ["earlier", ...items] }));

  assert.equal(viewport.scrollTop, 225);
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

test("chat waits for loaded history before restoring a saved position", () => {
  const reading: ReadingState = {
    position: { top: 125, pinned: false, anchor: { id: "b", top: -25 } },
  };

  const view = render(
    createElement(Chat, { reading, items: [], ready: false }),
  );

  assert.equal(reading.position?.top, 125);
  view.rerender(createElement(Chat, { reading, items, ready: true }));
  assert.equal(view.getByTestId("chat").scrollTop, 125);
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
