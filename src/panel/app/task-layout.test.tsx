// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { TaskLayout } from "./task-layout";

const storageKey = "dw_task_list_width";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

function setup(initialNarrow = false) {
  let narrow = initialNarrow;
  const listeners = new Set<() => void>();

  const removeEventListener = vi.fn((_: string, callback: () => void) => {
    listeners.delete(callback);
  });

  const media = {
    get matches() {
      return narrow;
    },
    addEventListener: (_: string, callback: () => void) => {
      listeners.add(callback);
    },
    removeEventListener,
  };

  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => media),
  );

  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );

  // jsdom does not perform flex layout; model 1000px of panel space plus an 8px separator.
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(
    function (this: HTMLElement) {
      if (this.hasAttribute("data-panel")) {
        return (
          (Number(this.style.flexGrow) > 1 ? Number(this.style.flexGrow) : 50) *
          10
        );
      }

      if (this.hasAttribute("data-group")) return 1008;
      if (this.hasAttribute("data-separator")) return 8;

      return 0;
    },
  );

  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.hasAttribute("data-group") ? 1008 : this.offsetWidth;
    },
  );

  vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(
    function (this: HTMLElement) {
      if (
        this.id === "task-inspector-panel" ||
        this.hasAttribute("data-separator")
      ) {
        return (
          ((this.parentElement?.querySelector("[data-panel]") as HTMLElement)
            ?.offsetWidth ?? 0) + (this.id === "task-inspector-panel" ? 8 : 0)
        );
      }

      return 0;
    },
  );

  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return new DOMRect(this.offsetLeft, 0, this.offsetWidth, 600);
    },
  );

  const view = render(
    <TaskLayout
      list={<input aria-label="Task search" defaultValue="draft" />}
      inspector={<main>Inspector</main>}
    />,
  );

  const separator = view.getByRole("separator", { name: "Resize task list" });
  const rail = view.getByTestId("task-rail-panel");

  return {
    ...view,
    separator,
    rail,
    removeEventListener,
    setNarrow(value: boolean) {
      narrow = value;
      act(() => listeners.forEach((listener) => listener()));
    },
  };
}

function width(rail: HTMLElement) {
  return Number(rail.style.flexGrow) * 10;
}

test("the real panel library restores the saved width and persists keyboard resizing within bounds", async () => {
  localStorage.setItem(storageKey, "350");
  const { separator, rail } = setup();

  expect(width(rail)).toBeCloseTo(350);
  expect(separator.getAttribute("aria-orientation")).toBe("vertical");

  fireEvent.keyDown(separator, { key: "ArrowRight" });
  await waitFor(() => expect(width(rail)).toBeCloseTo(400));
  await waitFor(() => expect(localStorage.getItem(storageKey)).toBe("400"));

  fireEvent.keyDown(separator, { key: "End" });
  await waitFor(() => expect(width(rail)).toBeCloseTo(480));
  fireEvent.keyDown(separator, { key: "ArrowRight" });
  expect(width(rail)).toBeCloseTo(480);

  fireEvent.keyDown(separator, { key: "Home" });
  await waitFor(() => expect(width(rail)).toBeCloseTo(220));
  fireEvent.keyDown(separator, { key: "ArrowLeft" });
  expect(width(rail)).toBeCloseTo(220);
  await waitFor(() => expect(localStorage.getItem(storageKey)).toBe("220"));
});

test("an unusable saved width restores the default without overwriting it", () => {
  localStorage.setItem(storageKey, "Infinity");
  const { rail } = setup();

  expect(width(rail)).toBeCloseTo(245);
  // Mounting is not a user interaction and must not overwrite preferences.
  expect(localStorage.getItem(storageKey)).toBe("Infinity");
});

test("double-click resets to 245 pixels instead of the saved initial width", async () => {
  localStorage.setItem(storageKey, "400");
  const { separator, rail } = setup();

  expect(width(rail)).toBeCloseTo(400);
  fireEvent.keyDown(separator, { key: "ArrowLeft" });
  await waitFor(() => expect(width(rail)).toBeCloseTo(350));

  fireEvent.doubleClick(separator);
  await waitFor(() => expect(width(rail)).toBeCloseTo(245));
  expect(localStorage.getItem(storageKey)).toBe("245");
});

test("narrow mode disables resizing and keeps both child trees mounted across breakpoints", async () => {
  localStorage.setItem(storageKey, "350");

  const {
    separator,
    rail,
    getByRole,
    setNarrow,
    removeEventListener,
    unmount,
  } = setup();

  const search = getByRole("textbox", { name: "Task search" });
  const inspector = getByRole("main");

  fireEvent.change(search, { target: { value: "unsent search" } });
  setNarrow(true);

  expect(getByRole("textbox", { name: "Task search" })).toBe(search);
  expect(getByRole("main")).toBe(inspector);
  expect((search as HTMLInputElement).value).toBe("unsent search");
  fireEvent.keyDown(separator, { key: "ArrowRight" });
  expect(width(rail)).toBeCloseTo(350);
  expect(localStorage.getItem(storageKey)).toBe("350");

  setNarrow(false);

  expect(getByRole("textbox", { name: "Task search" })).toBe(search);
  expect(getByRole("main")).toBe(inspector);
  fireEvent.keyDown(separator, { key: "ArrowRight" });
  await waitFor(() => expect(width(rail)).toBeCloseTo(400));
  await waitFor(() => expect(localStorage.getItem(storageKey)).toBe("400"));

  unmount();

  expect(removeEventListener).toHaveBeenCalledWith(
    "change",
    expect.any(Function),
  );
});

test("an initially narrow layout disables the group without dropping its children", () => {
  const { separator, rail, getByRole } = setup(true);

  expect(getByRole("textbox", { name: "Task search" })).toBeTruthy();
  expect(getByRole("main")).toBeTruthy();
  const initialWidth = width(rail);

  fireEvent.keyDown(separator, { key: "ArrowRight" });
  expect(width(rail)).toBe(initialWidth);
});
