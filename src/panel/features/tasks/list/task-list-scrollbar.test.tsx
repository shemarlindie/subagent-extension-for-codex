// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useRef } from "react";
import { afterEach, expect, test, vi } from "vitest";

import { TaskListScrollbar } from "./task-list-scrollbar";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(scrollHeight = 300, initialScrollTop = 50) {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );

  function Fixture() {
    const scrollerRef = useRef<HTMLDivElement>(null);

    const setScroller = (element: HTMLDivElement | null) => {
      if (!element) return;

      let scrollTop = Math.min(initialScrollTop, scrollHeight - 100);

      Object.defineProperties(element, {
        clientHeight: { configurable: true, value: 100 },
        scrollHeight: { configurable: true, value: scrollHeight },
        scrollTop: {
          configurable: true,
          get: () => scrollTop,
          set: (value: number) => {
            scrollTop = Math.max(0, Math.min(value, scrollHeight - 100));
          },
        },
      });

      scrollerRef.current = element;
    };

    return (
      <>
        <div id="task-list" ref={setScroller} />
        <TaskListScrollbar scrollerRef={scrollerRef} />
      </>
    );
  }

  const view = render(<Fixture />);
  const scroller = view.container.querySelector<HTMLElement>("#task-list")!;

  return { ...view, scroller };
}

function pointer(
  target: HTMLElement,
  type: string,
  values: { pointerId?: number; button?: number; clientY?: number } = {},
) {
  const event = new Event(type, { bubbles: true });

  for (const [key, value] of Object.entries({
    pointerId: 1,
    button: 0,
    clientY: 0,
    ...values,
  }))
    Object.defineProperty(event, key, { value });

  target.dispatchEvent(event);
}

test("shows a proportional thumb for an overflowing list", async () => {
  const { scroller } = setup();

  const thumb = await screen.findByRole("scrollbar", {
    name: "Task list scroll position",
  });

  expect(thumb.getAttribute("aria-controls")).toBe("task-list");
  expect(thumb.getAttribute("aria-valuenow")).toBe("25");
  expect(Number.parseFloat(thumb.style.height)).toBeCloseTo(100 / 3);
  expect(thumb.style.transform).toContain("16.666");
  expect(scroller.scrollTop).toBe(50);
});

test("hides the thumb when the list does not overflow", () => {
  const view = setup(100, 0);

  expect(view.queryByRole("scrollbar")).toBeNull();
});

test("keyboard controls scroll by a small step or page and clamp at both ends", async () => {
  const { scroller } = setup();
  const thumb = await screen.findByRole("scrollbar");

  fireEvent.keyDown(thumb, { key: "ArrowDown" });
  expect(scroller.scrollTop).toBe(90);
  fireEvent.scroll(scroller);
  await waitFor(() => expect(thumb.getAttribute("aria-valuenow")).toBe("45"));

  fireEvent.keyDown(thumb, { key: "PageDown" });
  expect(scroller.scrollTop).toBe(190);
  fireEvent.keyDown(thumb, { key: "End" });
  expect(scroller.scrollTop).toBe(200);
  fireEvent.keyDown(thumb, { key: "ArrowDown" });
  expect(scroller.scrollTop).toBe(200);

  fireEvent.keyDown(thumb, { key: "Home" });
  expect(scroller.scrollTop).toBe(0);
  fireEvent.keyDown(thumb, { key: "ArrowUp" });
  expect(scroller.scrollTop).toBe(0);
});

test("dragging maps pointer movement to scroll distance and stops on pointer up", async () => {
  const { scroller } = setup();
  const thumb = (await screen.findByRole("scrollbar")) as HTMLElement;
  const setCapture = vi.fn();
  const releaseCapture = vi.fn();

  Object.defineProperties(thumb, {
    setPointerCapture: { configurable: true, value: setCapture },
    releasePointerCapture: { configurable: true, value: releaseCapture },
  });

  pointer(thumb, "pointerdown", { pointerId: 3, clientY: 10 });
  pointer(thumb, "pointermove", { pointerId: 3, clientY: 20 });
  expect(scroller.scrollTop).toBeCloseTo(80);

  pointer(thumb, "pointerup", { pointerId: 3, clientY: 20 });
  pointer(thumb, "pointermove", { pointerId: 3, clientY: 30 });
  expect(scroller.scrollTop).toBeCloseTo(80);
  expect(setCapture).toHaveBeenCalledWith(3);
  expect(releaseCapture).toHaveBeenCalledWith(3);
});
