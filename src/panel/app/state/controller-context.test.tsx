// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { expect, onTestFinished, test, vi } from "vitest";

import type { Controller } from "./controller";
import {
  ControllerContext,
  shallowEqual,
  useSnapshot,
} from "./controller-context";
import type { Snapshot } from "./types";

function store(initial: Partial<Snapshot>) {
  let state = initial as Snapshot;
  const listeners = new Set<() => void>();

  return {
    controller: {
      getSnapshot: () => state,
      subscribe: (listener: () => void) => {
        listeners.add(listener);

        return () => listeners.delete(listener);
      },
    } as unknown as Controller,
    patch(patch: Partial<Snapshot>) {
      state = { ...state, ...patch };
      act(() => listeners.forEach((listener) => listener()));
    },
  };
}

test("rerenders only when a selected field changes", () => {
  onTestFinished(cleanup);
  const { controller, patch } = store({ search: "a", error: "", tasks: [] });
  let renders = 0;

  function Probe() {
    renders += 1;

    const { search, count } = useSnapshot(["search"], (state) => ({
      count: state.tasks.length,
    }));

    return (
      <p>
        {search} {count}
      </p>
    );
  }

  const view = render(
    <ControllerContext.Provider value={controller}>
      <Probe />
    </ControllerContext.Provider>,
  );

  patch({ error: "Lost connection" });
  expect(renders).toBe(1);

  patch({ search: "b" });
  expect(renders).toBe(2);
  expect(view.getByText("b 0")).toBeTruthy();
});

test("compares plain objects one level deep", () => {
  const item = { id: 1 };

  expect(shallowEqual({ a: 1, b: item }, { a: 1, b: item })).toBe(true);
  expect(shallowEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
  expect(shallowEqual({ b: item }, { b: { id: 1 } })).toBe(false);
  expect(shallowEqual([item], [item])).toBe(false);
  expect(shallowEqual(new Map(), new Map())).toBe(false);
  expect(shallowEqual(Number.NaN, Number.NaN)).toBe(true);
});

test("warns when a selector builds a new value for the same snapshot", () => {
  onTestFinished(cleanup);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  onTestFinished(() => warn.mockRestore());
  const { controller } = store({ tasks: [] });

  function Probe() {
    useSnapshot((state) => ({ ids: state.tasks.map((task) => task.id) }));

    return null;
  }

  render(
    <ControllerContext.Provider value={controller}>
      <Probe />
    </ControllerContext.Provider>,
  );

  expect(warn).toHaveBeenCalledOnce();
});
