// @vitest-environment jsdom
import assert from "node:assert/strict";

import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, onTestFinished, test, vi } from "vitest";

import { TaskLayout, useTaskRail } from "./task-layout";

const storageKey = "dw_task_list_width";
const collapsedKey = "dw_task_list_collapsed";

function Layout() {
  const rail = useTaskRail();

  return (
    <>
      <button type="button" onClick={rail.toggle}>
        {rail.collapsed ? "Show task list" : "Hide task list"}
      </button>
      <TaskLayout
        rail={rail}
        list={<input aria-label="Task search" defaultValue="draft" />}
        inspector={<main>Inspector</main>}
      />
    </>
  );
}

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
        const grow = Number(this.style.flexGrow);

        // A collapsed panel grows by 0; before layout the library sets 1.
        return (grow > 1 || this.style.flexGrow === "0" ? grow : 50) * 10;
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

  const view = render(<Layout />);

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

function list(container: HTMLElement) {
  const element = container.querySelector<HTMLElement>("#task-rail");
  assert.ok(element);

  return element;
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

  for (let step = 0; step < 6; step++) {
    fireEvent.keyDown(separator, { key: "ArrowLeft" });
  }

  await waitFor(() => expect(width(rail)).toBeCloseTo(220));
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

test("Enter hides the list without losing its width, and after a reload Enter reopens it at that width", async () => {
  localStorage.setItem(storageKey, "350");
  const first = setup();

  fireEvent.keyDown(first.separator, { key: "Enter" });
  await waitFor(() => expect(width(first.rail)).toBe(0));
  expect(first.getByRole("button", { name: "Show task list" })).toBeTruthy();
  // Keyboard and screen reader users must not reach the hidden list.
  expect(list(first.container).hidden).toBe(true);
  expect(list(first.container).hasAttribute("inert")).toBe(true);
  expect(localStorage.getItem(collapsedKey)).toBe("true");
  expect(localStorage.getItem(storageKey)).toBe("350");
  first.unmount();

  const second = setup();

  expect(width(second.rail)).toBe(0);
  fireEvent.keyDown(second.separator, { key: "Enter" });
  await waitFor(() => expect(width(second.rail)).toBeCloseTo(350));
  expect(second.getByRole("button", { name: "Hide task list" })).toBeTruthy();
  expect(localStorage.getItem(collapsedKey)).toBeNull();
});

test("clicking the collapsed divider reopens the list, but the click ending a collapse does not", async () => {
  const { separator, rail } = setup();

  fireEvent.pointerDown(separator);
  fireEvent.keyDown(separator, { key: "Enter" });
  await waitFor(() => expect(width(rail)).toBe(0));
  fireEvent.click(separator);
  expect(width(rail)).toBe(0);

  fireEvent.pointerDown(separator);
  fireEvent.click(separator);
  await waitFor(() => expect(width(rail)).toBeCloseTo(245));
});

test("the toggle eases the list closed, keeping it visible but out of reach until the motion ends", async () => {
  // jsdom has no Web Animations API, so the panel skips motion unless it appears available.
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value: vi.fn(),
  });

  onTestFinished(() => {
    Reflect.deleteProperty(HTMLElement.prototype, "animate");
  });

  const { container, getByRole, rail } = setup();
  const shell = container.querySelector<HTMLElement>(".shell");
  assert.ok(shell);

  fireEvent.click(getByRole("button", { name: "Hide task list" }));

  await waitFor(() => expect(width(rail)).toBe(0));
  expect(shell.hasAttribute("data-rail-motion")).toBe(true);
  // The list keeps its width while its panel shrinks, so rows don't rewrap.
  expect(list(container).style.minWidth).toBe("245px");
  expect(list(container).hidden).toBe(false);
  expect(list(container).hasAttribute("inert")).toBe(true);

  await waitFor(() => expect(list(container).hidden).toBe(true));
  expect(shell.hasAttribute("data-rail-motion")).toBe(false);
});
